/*
 * Two rules for the moment an administrator finishes provider setup.
 *
 * Saving a workspace's own app already continues into provider sign-in. What
 * was missing: the sign-in has to be for the product the administrator set out
 * to connect, and when the server still refuses to start, the administrator
 * needs to see what is actually wrong. Browser-safe and pure.
 */
import type {
  IntegrationReadinessRow,
  ReadinessBlocker,
} from "@/lib/integration-readiness.functions";

export type HandoffConnector = { id: string; provider?: string | null | undefined };

/**
 * Which connector sign-in should continue with after app details are saved.
 *
 * One app serves several products, so an administrator who set out to connect
 * Instagram may well save the Meta app from the Facebook row. Continue with
 * their choice whenever it uses the same app, and otherwise with the connector
 * that was configured -- never with an unrelated product.
 */
export function continueTarget(
  savedId: string,
  chosenId: string | null,
  connectors: readonly HandoffConnector[],
): string {
  const saved = connectors.find((c) => c.id === savedId);
  const chosen = chosenId ? connectors.find((c) => c.id === chosenId) : undefined;
  if (saved?.provider && chosen && chosen.provider === saved.provider) return chosen.id;
  return savedId;
}

const SEVERITY_ORDER: Record<ReadinessBlocker["severity"], number> = {
  BLOCKING: 0,
  WARNING: 1,
  INFO: 2,
};

/**
 * What an administrator still has to fix, most urgent first. Information-only
 * notes are left out: this list exists to be acted on.
 */
export function actionableBlockers(
  row: Pick<IntegrationReadinessRow, "blockers"> | undefined | null,
): ReadinessBlocker[] {
  return (row?.blockers ?? [])
    .filter((b) => b.severity !== "INFO")
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
