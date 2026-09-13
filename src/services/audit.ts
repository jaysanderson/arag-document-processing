/**
 * Audited changes: who, what, when — append-only, in the product's own store.
 *
 * Every write that changes how this deployment behaves lands here: settings edits, API-key
 * creation and revocation, extraction-config create/edit/delete/provision, purge (manual and
 * scheduled) and document deletion. Secrets are redacted to `"***"` on the way in, so the log
 * can be read by anyone who can already read the admin panel without handing them a key.
 *
 * The actor travels with the request, not with the call site: `auditContext()` is a
 * middleware that stashes the caller on an `AsyncLocalStorage` for the life of the request,
 * so a service wrapped by `auditCalls()` records who asked without every service learning
 * about HTTP.
 *
 * Paging is by a monotonic sequence number rather than an offset, because an offset is wrong
 * the moment a new entry arrives: `?cursor=…&direction=older|newer` walks a stable window in
 * both directions with no duplicates and no gaps, however much arrives in between. The same
 * cursor shape is applied to the runtime log ring buffer (`/api/v1/admin/logs`), whose
 * records get their sequence lazily from a WeakMap — the vendored logger is never edited.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  badRequest,
  type Collection,
  type Ctx,
  type Logger,
  type LogRecord,
  type Middleware,
  type Store,
  type StoredDoc,
} from "../../vendor/arag-platform/src/index.ts";

export type ActorType = "admin" | "api-key" | "session" | "anonymous" | "system";

export interface Actor {
  type: ActorType;
  /** Human label: "admin token", an API key's name, "session", or "scheduler". */
  name: string;
}

export interface AuditEntry extends StoredDoc {
  id: string;
  /** Monotonic, gap-free ordering key. The cursor is an encoding of this. */
  seq: number;
  ts: string;
  actor: Actor;
  /** Dotted verb: `settings.update`, `apikey.create`, `config.delete`, `documents.purge`… */
  action: string;
  /** What was acted on: a setting key, a key id, a config id, a document id. */
  target: string;
  before: unknown;
  after: unknown;
  /** Correlates the entry with the request log. */
  requestId: string | null;
  detail?: string;
}

export interface AuditInput {
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  detail?: string;
  /** Overrides the request-scoped actor (the purge scheduler has no request). */
  actor?: Actor;
  requestId?: string | null;
}

const SYSTEM: Actor = { type: "system", name: "scheduler" };
const ANONYMOUS: Actor = { type: "anonymous", name: "anonymous" };

const ctxStore = new AsyncLocalStorage<{ actor: Actor; requestId: string }>();

/** Secret-looking keys are never written to the audit log in the clear. */
/**
 * Property names that carry a credential.
 *
 * Anchored at the **end** of the name, so it matches what a secret is actually called —
 * `apiKey`, `api_key`, `adminToken`, `clientSecret`, `password`, `authorization`, `cookie` —
 * rather than anything merely containing one of those words. The previous pattern was an
 * unanchored `/key/`, which redacted every extraction-config field's own `key` and the
 * `provisioning.keyValueSchema` on a `config.create` entry: an audit log that hides the
 * thing being audited is worse than no audit log, because it looks complete.
 */
const SECRET_KEY = /(^|[a-z0-9_.-])(api[_.-]?key|secret|password|passwd|token|authorization|cookie)s?$/i;
/** …except these, which are counts, toggles and identifiers rather than credentials. */
const NOT_SECRET = /^(kbId|keyId|apiKeys|requireApiKey|keys)$/;

/** Deep-copy a value with secret-looking fields replaced by `"***"`. */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) && !NOT_SECRET.test(k) ? "***" : redactDeep(v, depth + 1);
  }
  return out;
}

export interface CursorPage<T> {
  items: T[];
  /** Follow to continue in the reading direction; null at the end. */
  nextCursor: string | null;
  /** Follow to walk back the way you came; null at the start. */
  prevCursor: string | null;
  hasMore: boolean;
  hasPrev: boolean;
  /** Rows matching the filter, across every page. */
  total: number;
}

export type CursorDirection = "older" | "newer";

export function encodeCursor(seq: number): string {
  return Buffer.from(`s${seq}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number | null {
  if (!cursor) return null;
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const n = /^s(\d+)$/.exec(raw);
  if (!n) throw badRequest("Invalid cursor. Use the `nextCursor` or `prevCursor` from a previous page.");
  return Number(n[1]);
}

/**
 * Page a sequence-ordered list. `rows` must be ascending by `seq`. `order` is presentation
 * only: "desc" hands back the newest first (the audit log), "asc" the oldest first (the
 * runtime log, which has always read like a terminal).
 */
export function pageBySeq<T>(
  rows: readonly T[],
  seqOf: (row: T) => number,
  opts: { limit?: number; cursor?: string; direction?: CursorDirection; order?: "asc" | "desc" } = {},
): CursorPage<T> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const cursor = decodeCursor(opts.cursor);
  const direction: CursorDirection = opts.direction ?? "older";
  let window: T[];
  if (cursor === null) window = rows.slice(-limit);
  else if (direction === "newer") window = rows.filter((r) => seqOf(r) > cursor).slice(0, limit);
  else window = rows.filter((r) => seqOf(r) < cursor).slice(-limit);

  const first = window[0];
  const last = window[window.length - 1];
  const oldestRow = rows[0];
  const newestRow = rows[rows.length - 1];
  const olderSeq = first ? seqOf(first) : (cursor ?? (oldestRow ? seqOf(oldestRow) : null));
  const newerSeq = last ? seqOf(last) : (cursor ?? (newestRow ? seqOf(newestRow) : null));
  const hasOlder = olderSeq !== null && rows.some((r) => seqOf(r) < olderSeq);
  const hasNewer = newerSeq !== null && rows.some((r) => seqOf(r) > newerSeq);
  const olderCursor = olderSeq === null ? null : encodeCursor(olderSeq);
  const newerCursor = newerSeq === null ? null : encodeCursor(newerSeq);
  const desc = (opts.order ?? "desc") === "desc";
  return {
    items: desc ? [...window].reverse() : window,
    // Reading newest-first, "next" means older; reading oldest-first, "next" means newer.
    nextCursor: desc ? olderCursor : newerCursor,
    prevCursor: desc ? newerCursor : olderCursor,
    hasMore: desc ? hasOlder : hasNewer,
    hasPrev: desc ? hasNewer : hasOlder,
    total: rows.length,
  };
}

/** Lazily assigned, stable sequence numbers for the logger's ring buffer records. */
const logSeq = new WeakMap<LogRecord, number>();
let logSeqNext = 1;

/**
 * Page the runtime log ring with the same cursor contract as the audit log. Records are
 * numbered on first read, in ring order, so numbers are stable for the life of the process
 * and a record evicted from the ring simply stops appearing.
 */
export function pageLogRing(
  ring: readonly LogRecord[],
  opts: {
    level?: string;
    contains?: string;
    limit?: number;
    cursor?: string;
    direction?: CursorDirection;
  } = {},
): CursorPage<LogRecord> {
  for (const rec of ring) if (!logSeq.has(rec)) logSeq.set(rec, logSeqNext++);
  const order: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = opts.level ? (order[opts.level] ?? 0) : 0;
  const q = opts.contains?.toLowerCase();
  const rows = ring.filter(
    (r) => (order[r.level] ?? 0) >= min && (!q || JSON.stringify(r).toLowerCase().includes(q)),
  );
  return pageBySeq(rows, (r) => logSeq.get(r) ?? 0, { ...opts, order: "asc" });
}

export class AuditService {
  private readonly col: Collection<AuditEntry>;
  private readonly log: Logger;
  private seq: number;

  constructor(deps: { store: Store; log: Logger; cap?: number }) {
    this.col = deps.store.collection<AuditEntry>("audit", { cap: deps.cap ?? 5000 });
    this.log = deps.log;
    this.seq = this.col.list().reduce((max, e) => Math.max(max, e.seq ?? 0), 0);
  }

  /** The caller of the request currently being handled, or the scheduler outside one. */
  static currentActor(): Actor {
    return ctxStore.getStore()?.actor ?? SYSTEM;
  }

  /** Append an entry. Never throws into the caller's path: an audit failure must not 500 a save. */
  record(input: AuditInput): AuditEntry | null {
    try {
      const scope = ctxStore.getStore();
      const seq = ++this.seq;
      const entry = this.col.put({
        // Zero-padded so the store's own createdAt ordering and the seq ordering agree.
        id: `a${String(seq).padStart(12, "0")}`,
        seq,
        ts: new Date().toISOString(),
        actor: input.actor ?? scope?.actor ?? ANONYMOUS,
        action: input.action,
        target: input.target,
        before: redactDeep(input.before ?? null),
        after: redactDeep(input.after ?? null),
        requestId: input.requestId ?? scope?.requestId ?? null,
        detail: input.detail,
      });
      return entry;
    } catch (err) {
      this.log.warn("audit.record.fail", { action: input.action, message: (err as Error).message });
      return null;
    }
  }

  /** One page of the audit log, newest first, with filters that combine with AND. */
  page(
    opts: {
      limit?: number;
      cursor?: string;
      direction?: CursorDirection;
      action?: string;
      actor?: string;
      target?: string;
    } = {},
  ): CursorPage<AuditEntry> {
    const rows = this.col
      .list({ sort: (a, b) => a.seq - b.seq })
      .filter(
        (e) =>
          (!opts.action || e.action === opts.action || e.action.startsWith(`${opts.action}.`)) &&
          (!opts.actor || e.actor.name === opts.actor || e.actor.type === opts.actor) &&
          (!opts.target || e.target === opts.target),
      );
    return pageBySeq(rows, (e) => e.seq, opts);
  }

  /** Distinct actions seen so far — the filter dropdown on the audit screen. */
  actions(): string[] {
    return [...new Set(this.col.list().map((e) => e.action))].sort();
  }

  get size(): number {
    return this.col.size;
  }
}

/**
 * Middleware: resolve who is calling once per request and make it available to every service
 * underneath. `describeKey` turns an authenticated API key into its stored name.
 */
export function auditContext(describeKey: (key: string) => string | undefined): Middleware {
  return async (ctx: Ctx, next) => {
    await ctxStore.run({ actor: actorFor(ctx, describeKey), requestId: ctx.requestId }, next);
  };
}

function actorFor(ctx: Ctx, describeKey: (key: string) => string | undefined): Actor {
  if (ctx.auth.admin) return { type: "admin", name: "admin token" };
  if (ctx.auth.apiKey) return { type: "api-key", name: describeKey(ctx.auth.apiKey) ?? "API key" };
  if (ctx.auth.session) return { type: "session", name: "session" };
  return ANONYMOUS;
}

/**
 * Wrap named async methods of a service so each successful call writes an audit entry,
 * without the service itself knowing the audit log exists. The instance property shadows the
 * prototype method, so internal `this.method()` calls are audited too — which is what we
 * want for `bulkDelete`, whose per-document deletes should each be recorded.
 */
export function auditCalls<T extends object>(
  target: T,
  audit: AuditService,
  wraps: Array<{
    method: keyof T & string;
    action: string;
    /** Identify the thing being acted on from the call arguments and the result. */
    targetOf: (args: unknown[], result: unknown) => string;
    /** Snapshot before the call (skipped when absent). */
    before?: (args: unknown[]) => unknown;
    /** Turn the return value into the "after" side; returning `undefined` skips the entry. */
    after?: (result: unknown, args: unknown[]) => unknown;
  }>,
): void {
  for (const w of wraps) {
    const original = target[w.method] as unknown as (...args: unknown[]) => unknown;
    if (typeof original !== "function") continue;
    const bound = original.bind(target);
    (target as Record<string, unknown>)[w.method] = async (...args: unknown[]) => {
      const before = w.before ? w.before(args) : undefined;
      const result = await bound(...args);
      const after = w.after ? w.after(result, args) : result;
      if (after !== undefined) {
        audit.record({ action: w.action, target: w.targetOf(args, result), before, after });
      }
      return result;
    };
  }
}
