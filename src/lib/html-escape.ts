/**
 * Escapes text that is about to be written into an HTML page built by hand.
 *
 * The plugin activation page prints a site's own name. A name is typed by a
 * customer, so printing it raw let one workspace's text become markup -- or a
 * script -- in a page someone else opens.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
