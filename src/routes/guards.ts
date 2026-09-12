/**
 * Route guards that go beyond the platform's two-state `auth: "api"` (which is fully open
 * whenever `API_KEYS` is unset — the shipped default).
 */
import type { Ctx } from "../../vendor/arag-platform/src/index.ts";
import { unauthorized } from "../../vendor/arag-platform/src/index.ts";

/**
 * Destructive verbs always need a credential, even when the public API is otherwise open.
 *
 * Reads and uploads stay anonymous-friendly so the demo, the docs and `curl` quickstarts
 * work with no setup; but deleting a document also deletes the Knowledge Box resource, and
 * an anonymous caller must not be able to destroy another tenant's data just because
 * `API_KEYS` was left empty. Any of these satisfies the guard:
 *
 *   - `ADMIN_TOKEN` (bearer or the `arag_admin` cookie)
 *   - an `X-API-Key` / bearer API key, when `API_KEYS` is configured
 *   - a same-origin session cookie from `POST /api/v1/session` (SameSite=Lax, so a
 *     cross-site form or fetch cannot replay it)
 *
 * Platform gap: the toolkit has no `auth: "api-write"` mode; reported to the Head.
 */
export function requireWriter(ctx: Ctx): void {
  if (ctx.auth.admin || ctx.auth.apiKey || ctx.auth.session) return;
  throw unauthorized(
    "Destructive operations require a credential: send an API key (X-API-Key or Authorization: Bearer), " +
      "the admin token, or call POST /api/v1/session first to obtain a same-origin session cookie.",
  );
}
