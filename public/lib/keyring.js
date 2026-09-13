/**
 * The session key ring.
 *
 * An API key's plaintext exists exactly once — in the response to `POST /api/v1/admin/api-keys`
 * — because the server keeps only a salted digest. That is the right design, and it leaves one
 * gap in the product: having just minted a key, you cannot try it in the API explorer without
 * pasting it back in from wherever you saved it.
 *
 * So a key created in this tab is held here, in memory, for as long as the tab is open, and the
 * explorer's credential picker offers it *by name*. Deliberately not `localStorage` and not
 * `sessionStorage`: a key written to disk is a key that outlives the person who created it.
 * A reload empties the ring, which is correct — the key is gone from the browser, not from the
 * deployment.
 */

/** id → { id, name, prefix, key } */
const ring = new Map();

/** Remember the plaintext of a key just created, against its stored record. */
export function remember(record, key) {
  if (!record?.id || !key) return;
  ring.set(record.id, { id: record.id, name: record.name, prefix: record.prefix, key });
}

/** The keys this tab minted, newest last. Never persisted, never logged. */
export function listRemembered() {
  return [...ring.values()];
}

export function rememberedKey(id) {
  return ring.get(id)?.key ?? "";
}

/** Drop a key from the ring — used when it is revoked, so the picker cannot offer a dead key. */
export function forget(id) {
  ring.delete(id);
}
