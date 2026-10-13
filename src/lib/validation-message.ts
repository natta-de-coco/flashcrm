// Tells a server's "this input is not valid" dump apart from a sentence written
// for a person.
//
// Every server function here checks its input with zod before it runs, and a
// failed check throws an error whose message is zod's list of issues as JSON —
// [{"code":"too_big","maximum":4000,"path":["notes"],...}]. A screen that puts
// error.message in a toast shows that list word for word. Screens use this to
// notice it and say one plain sentence of their own instead. Pure and
// browser-safe.

/** True when the message is a list of validation issues rather than words for a person. */
export function isValidationDump(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const trimmed = message.trim();
  if (!trimmed.startsWith("[")) return false;
  try {
    const issues: unknown = JSON.parse(trimmed);
    return (
      Array.isArray(issues) &&
      issues.length > 0 &&
      issues.every((issue) => {
        const i = issue as { code?: unknown; path?: unknown } | null;
        return Boolean(i) && typeof i!.code === "string" && Array.isArray(i!.path);
      })
    );
  } catch {
    return false;
  }
}
