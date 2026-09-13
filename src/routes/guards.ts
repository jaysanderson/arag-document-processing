/**
 * Route guards that go beyond the platform's two-state `auth: "api"` (which is fully open
 * whenever `API_KEYS` is unset — the shipped default).
 */
import type { Ctx } from "../../vendor/arag-platform/src/index.ts";
import { unauthorized } from "../../vendor/arag-platform/src/index.ts";

/**
 * Writes that change shared state always need a credential, even when the public API is
 * otherwise open: the three `DELETE`s, and `POST /api/v1/extraction-configs` (which
 * provisions a real stored ARAG search configuration in the Knowledge Box).
 *
 * Reads and document uploads stay anonymous-friendly so the demo, the docs and `curl`
 * quickstarts work with no setup — an upload only adds the caller's own document, and is
 * rate-limited. But deleting a document also deletes the Knowledge Box resource, and
 * creating a config writes into the KB's own configuration; an anonymous caller must not
 * be able to destroy or pollute shared state just because `API_KEYS` was left empty.
 * Any of these satisfies the guard:
 *
 *   - `ADMIN_TOKEN` (bearer or the `arag_admin` cookie)
 *   - an `X-API-Key` / bearer API key: one created in the product (Settings → API keys,
 *     `POST /api/v1/admin/api-keys`) or one seeded by `API_KEYS`. `server.ts` extends the
 *     platform's authentication so a stored key — verified against its salted digest —
 *     arrives here as `ctx.auth.apiKey`, exactly like an environment key
 *   - a same-origin session cookie from `POST /api/v1/session` (SameSite=Lax, so a
 *     cross-site form or fetch cannot replay it)
 *
 * Platform gap: the toolkit has no `auth: "api-write"` mode; reported to the Head.
 */
export function requireWriter(ctx: Ctx): void {
  if (ctx.auth.admin || ctx.auth.apiKey || ctx.auth.session) return;
  throw unauthorized(
    "This operation requires a credential: send an API key (X-API-Key or Authorization: Bearer), " +
      "the admin token, or call POST /api/v1/session first to obtain a same-origin session cookie.",
  );
}
