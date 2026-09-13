/**
 * API keys, for real — the store that replaces the `API_KEYS` environment placeholder.
 *
 * A key is created once, shown once, and never again: only a salted SHA-256 digest is kept,
 * so a leaked store file cannot be replayed against the API. The plaintext carries its own
 * record id (`dip_<id>_<secret>`), which makes verification an O(1) lookup plus one
 * constant-time compare rather than a scan over every stored digest.
 *
 * Why SHA-256 and not scrypt: the secret is 256 bits from `randomBytes`, not a human-chosen
 * password, so there is nothing to brute-force and nothing to gain from a slow KDF — and a
 * 100 ms KDF on the authentication path of every request would be a self-inflicted outage.
 *
 * `API_KEYS` keeps working as a seed/fallback so a live deployment does not break when this
 * store is empty (`SettingsService.seedApiKeys`).
 */
import { createHash, randomBytes } from "node:crypto";
import {
  badRequest,
  type Collection,
  constantTimeEqual,
  type Logger,
  type Store,
  type StoredDoc,
} from "../../vendor/arag-platform/src/index.ts";

/** Stored shape. The plaintext key is not in here and cannot be recovered from it. */
export interface ApiKeyRecord extends StoredDoc {
  id: string;
  name: string;
  /** The non-secret leading part of the key, e.g. `dip_3f9c1a2b` — safe to display. */
  prefix: string;
  salt: string;
  hash: string;
  /** Who created it (admin token, an API key's name, or a session). */
  createdBy: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** What `GET /api/v1/admin/api-keys` returns: never the key, never the hash, never the salt. */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revoked: boolean;
}

const PREFIX = "dip";
/** Persist `lastUsedAt` at most this often per key: an auth check must not cost a store write. */
const USAGE_FLUSH_MS = 60_000;

export class ApiKeysService {
  private readonly col: Collection<ApiKeyRecord>;
  private readonly log: Logger;
  /** id → last-seen timestamp, held in memory and folded into the store on a timer. */
  private readonly usage = new Map<string, number>();
  private readonly persisted = new Map<string, number>();

  constructor(deps: { store: Store; log: Logger }) {
    this.col = deps.store.collection<ApiKeyRecord>("apikeys");
    this.log = deps.log;
  }

  /**
   * Mint a key. The plaintext is returned exactly once — this is the only moment it exists
   * outside the caller's terminal.
   */
  create(input: { name: string; createdBy: string }): { record: ApiKeyView; key: string } {
    const name = String(input.name ?? "").trim();
    if (!name) throw badRequest("A key needs a name so an operator can tell it from the others.");
    if (name.length > 80) throw badRequest("The name must be 80 characters or fewer.");
    const id = randomBytes(4).toString("hex");
    const secret = randomBytes(32).toString("base64url");
    const salt = randomBytes(16).toString("hex");
    const prefix = `${PREFIX}_${id}`;
    const key = `${prefix}_${secret}`;
    const rec = this.col.put({
      id,
      name,
      prefix,
      salt,
      hash: digest(secret, salt),
      createdBy: input.createdBy,
      lastUsedAt: null,
      revokedAt: null,
    });
    this.log.info("apikey.create", { id, name });
    return { record: view(rec), key };
  }

  /** Every key, newest first. Revoked keys stay listed so the history is readable. */
  list(): ApiKeyView[] {
    return this.col.list().map((r) => view(r, this.usage.get(r.id)));
  }

  get(id: string): ApiKeyView | undefined {
    const rec = this.col.get(id);
    return rec ? view(rec, this.usage.get(rec.id)) : undefined;
  }

  /** Number of keys that can still authenticate. */
  activeCount(): number {
    return this.col.list({ filter: (r) => !r.revokedAt }).length;
  }

  /** Revoke a key. Returns false when the id is unknown; revoking twice is a no-op success. */
  revoke(id: string): ApiKeyView | null {
    const rec = this.col.get(id);
    if (!rec) return null;
    if (rec.revokedAt) return view(rec);
    const updated = this.col.update(id, { revokedAt: new Date().toISOString() })!;
    this.usage.delete(id);
    this.log.info("apikey.revoke", { id, name: rec.name });
    return view(updated);
  }

  /**
   * Authenticate a presented key. Returns the record on success and records the use in
   * memory; the store is written at most once a minute per key (`flushUsage`).
   */
  verify(presented: string | undefined | null): ApiKeyRecord | null {
    if (!presented || !presented.startsWith(`${PREFIX}_`)) return null;
    // The secret is base64url and may itself contain "_", so split on the first separator
    // after the id rather than on every underscore.
    const rest = presented.slice(PREFIX.length + 1);
    const sep = rest.indexOf("_");
    if (sep <= 0) return null;
    const rec = this.col.get(rest.slice(0, sep));
    if (!rec || rec.revokedAt) return null;
    if (!constantTimeEqual(digest(rest.slice(sep + 1), rec.salt), rec.hash)) return null;
    this.touch(rec.id);
    return rec;
  }

  private touch(id: string): void {
    const now = Date.now();
    this.usage.set(id, now);
    const last = this.persisted.get(id) ?? 0;
    if (now - last < USAGE_FLUSH_MS) return;
    this.persisted.set(id, now);
    this.col.update(id, { lastUsedAt: new Date(now).toISOString() });
  }

  /** Fold the in-memory usage marks into the store (called on shutdown). */
  flushUsage(): void {
    for (const [id, at] of this.usage) {
      const rec = this.col.get(id);
      if (!rec) continue;
      const iso = new Date(at).toISOString();
      if (rec.lastUsedAt !== iso) this.col.update(id, { lastUsedAt: iso });
    }
  }
}

function digest(secret: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${secret}`).digest("hex");
}

function view(r: ApiKeyRecord, seenAt?: number): ApiKeyView {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    // The in-memory mark is newer than the store between flushes; report the truth.
    lastUsedAt: seenAt ? new Date(seenAt).toISOString() : r.lastUsedAt,
    revokedAt: r.revokedAt,
    revoked: Boolean(r.revokedAt),
  };
}
