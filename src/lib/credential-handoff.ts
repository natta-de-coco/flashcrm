/*
 * What happens after an administrator saves a workspace's own provider app.
 *
 * Saving app details only stores credentials. It does not start sign-in and it
 * does not connect an account. The Integrations screen used to close the form
 * and leave the admin inside the diagnostics dialog with no next step, so a
 * workspace could read "Ready to connect" and never actually connect. These
 * rules decide the explicit next step instead. Browser-safe and pure.
 */
import type {
  IntegrationReadinessRow,
  ReadinessBlocker,
} from "@/lib/integration-readiness.functions";

export type HandoffConnector = { id: string; provider?: string | null | undefined };

/**
 * The connector to continue with after saving.
 *
 * The one the administrator originally chose wins when it uses the same
 * provider app as the one just configured -- saving Meta keys after choosing
 * Instagram continues with Instagram. Anything else continues with the
 * connector that was configured, never with a different product.
 */
export function continueTarget(
  savedId: string,
  returnToId: string | null,
  connectors: readonly HandoffConnector[],
): string {
  const saved = connectors.find((c) => c.id === savedId);
  const chosen = returnToId ? connectors.find((c) => c.id === returnToId) : undefined;
  if (saved?.provider && chosen && chosen.provider === saved.provider) return chosen.id;
  return savedId;
}

export type HandoffPhase = "checking" | "ready" | "blocked" | "unknown";

/**
 * Whether sign-in can start, judged only from a readiness result fetched AFTER
 * the save. Until that refetch lands the old row still says setup is required,
 * so the phase is "checking" rather than a false "blocked" (or a stale "ready").
 */
export function handoffPhase(
  row: Pick<IntegrationReadinessRow, "status"> | undefined,
  refreshing: boolean,
): HandoffPhase {
  if (refreshing) return "checking";
  if (!row) return "unknown";
  return row.status === "READY" || row.status === "LIMITED" ? "ready" : "blocked";
}

const SEVERITY_ORDER: Record<ReadinessBlocker["severity"], number> = {
  BLOCKING: 0,
  WARNING: 1,
  INFO: 2,
};

/** What the administrator still has to fix, most urgent first. */
export function actionableBlockers(
  row: Pick<IntegrationReadinessRow, "blockers"> | undefined,
): ReadinessBlocker[] {
  return (row?.blockers ?? [])
    .filter((b) => b.severity !== "INFO")
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
