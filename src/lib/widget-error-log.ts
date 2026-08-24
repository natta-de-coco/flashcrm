import { reportWidgetError } from "@/lib/widget-errors.functions";

/**
 * Client-side widget error reporter. Logs to the browser console immediately
 * and forwards the failure (widget name, endpoint, message) to the server so
 * it lands in function logs and the audit trail. Fire-and-forget: reporting
 * must never surface its own errors to the UI.
 */
export function logWidgetError(widget: string, endpoint: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[widget:${widget}] ${endpoint} failed:`, error);
  void reportWidgetError({
    data: {
      widget,
      endpoint,
      message: message.slice(0, 500),
      ...(stack ? { stack: stack.slice(0, 2000) } : {}),
    },
  }).catch(() => {
    /* swallow — error reporting must never throw */
  });
}
