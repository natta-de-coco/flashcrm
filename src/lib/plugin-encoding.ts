/**
 * How text gets into the files of a generated website plugin.
 *
 * The WordPress and Shopify plugins are built by pasting values into source
 * code: a greeting typed in Flas, the site key, the address of this workspace.
 * Pasted raw, a typed value can end the string it sits in and become PHP, Liquid
 * or HTML on a customer's website. The rule here is that text is only ever
 * written into a generated file through one of these functions, and that a
 * value which cannot be written safely stops the build instead of being
 * guessed at.
 *
 * Nothing here imports anything, so it can be tested on its own.
 */

/** The longest greeting a plugin carries; a longer one is cut, not refused. */
export const GREETING_MAX_LENGTH = 300;

// Every control character except tab (0x09) and newline (0x0A): NUL, carriage
// return, escape, delete and the 0x80-0x9F block. (Matching control characters
// is the point of these three patterns, so the lint rule against it is off.)
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_TAB_AND_NEWLINE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

// All control characters, for text that is going to be on a single line.
// eslint-disable-next-line no-control-regex
const ANY_CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

const SITE_KEY = /^[A-Za-z0-9_-]{10,120}$/;
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i;

// Characters that never belong in an address and could end a quoted value if
// one slipped through: whitespace, quotes, angle brackets, backslash, control.
// eslint-disable-next-line no-control-regex
const NOT_IN_AN_ADDRESS = /[\s\u0000-\u001F\u007F-\u009F"'`<>\\]/;

/** Cuts a greeting to its limit by whole characters, never through the middle of one. */
export function clampGreeting(text: string): string {
  const characters = Array.from(String(text ?? ""));
  return characters.length > GREETING_MAX_LENGTH
    ? characters.slice(0, GREETING_MAX_LENGTH).join("")
    : characters.join("");
}

/**
 * The text as the body of a PHP single-quoted string, that is what goes between
 * the two quote marks. In PHP single quotes only the backslash and the quote
 * mark are special, so escaping those two (the backslash first, or the escape
 * added for a quote would itself be doubled) is complete. Control characters
 * other than newline and tab are dropped. No base64: scanners flag it.
 */
export function phpSingleQuoted(text: string): string {
  return String(text ?? "")
    .replace(CONTROL_EXCEPT_TAB_AND_NEWLINE, "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

/**
 * The text as the body of a Liquid double-quoted string that itself sits inside
 * an HTML attribute. Liquid strings have no escape sequences at all, so a
 * character that could end the string or open a tag is replaced or removed:
 * a double quote becomes a single quote, braces go (so no `{{`, `}}`, `{%` or
 * `%}` can form), line breaks and tabs become one space, control characters go.
 * The page must still print the value through Liquid's `escape` filter.
 */
export function liquidDoubleQuoted(text: string): string {
  return String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(ANY_CONTROL, "")
    .replace(/"/g, "'")
    .replace(/[{}]/g, "");
}

/** A site key as stored for a connected site, or an error if it holds anything else. */
export function safeSiteKey(value: string): string {
  if (typeof value !== "string" || !SITE_KEY.test(value)) {
    throw new Error("The site key cannot be written into a plugin file.");
  }
  return value;
}

/**
 * The address of this workspace, reduced to scheme, host and port. Only https
 * is accepted (http only for a developer's own machine), and a value carrying
 * anything that could end a quoted string is refused rather than trimmed.
 */
export function safeOrigin(value: string): string {
  const refuse = () => new Error("The workspace address cannot be written into a plugin file.");
  if (typeof value !== "string" || NOT_IN_AN_ADDRESS.test(value)) throw refuse();

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw refuse();
  }

  const onThisMachine = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const schemeAllowed =
    parsed.protocol === "https:" || (parsed.protocol === "http:" && onThisMachine);
  const origin = parsed.origin;
  if (!schemeAllowed || !ORIGIN.test(origin)) throw refuse();
  return origin;
}
