/**
 * The workspace session.
 *
 * `POST /api/v1/session` exchanges same-origin-ness for a short-lived HttpOnly cookie, which
 * is what lets the browser make the writes DP-12 protects — a delete, a config, a field
 * correction — without a key pasted into the page. The cookie cannot be read back from
 * JavaScript, so the one thing the UI needs to know (may this visitor write?) is recorded
 * here when the exchange happens, and read by the screens that offer a write.
 *
 * `writer` is `null` until the exchange settles: a menu item is enabled optimistically
 * rather than flickering, and a write that turns out to be unauthorised says so with the
 * server's own words.
 */
import { api } from "./core.js";

export const session = { writer: null };

export async function startSession() {
  try {
    await api("/api/v1/session", { method: "POST" });
    session.writer = true;
  } catch {
    // The open case: API keys are not configured, so the session endpoint is not needed.
    session.writer = false;
  }
  return session.writer;
}

/** May this visitor make a write? Optimistic until the session exchange has settled. */
export const canWrite = () => session.writer !== false;
