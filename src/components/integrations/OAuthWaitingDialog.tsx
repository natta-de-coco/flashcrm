/*
 * The dialog that stands in for "come back here when you're done".
 *
 * Strictly presentational, and strictly about the waiting phases. It shows
 * what the browser is doing — the sign-in window is open, the browser refused
 * to open one, the window went away — and hands every finished outcome to
 * onOutcome, so the result screens live with the page that knows what to do
 * with a connection.
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PROVIDER_NAMES,
  type ConnectAttempt,
  type OAuthProviderId,
} from "@/lib/connection-problem";
import { connector } from "@/lib/connections-catalog";
import { type ConnectPhase, isTerminalPhase, isWaitingPhase } from "@/lib/oauth-return";
import { ExternalLink, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";

export type OAuthWaitingDialogProps = {
  phase: ConnectPhase;
  /** Connector id, e.g. "instagram". Null before the first Connect. */
  platform: string | null;
  attempt: ConnectAttempt | null;
  /** Full-page redirect, for a browser that refused the popup. */
  onContinueInThisTab: () => void;
  onRetry: () => void;
  onCancel: () => void;
  /**
   * Called once, as soon as the attempt reaches a finished phase. The page
   * composes the result screen — this dialog deliberately renders none.
   */
  onOutcome: (attempt: ConnectAttempt | null, phase: ConnectPhase) => void;
};

/** "Meta", not "Facebook": whose login screen is open is what people see. */
function providerLabel(platform: string | null): string {
  if (!platform) return "the provider";
  const meta = connector(platform);
  const provider = meta?.provider;
  if (provider) return PROVIDER_NAMES[provider as OAuthProviderId] ?? meta?.name ?? platform;
  return meta?.name ?? platform.replace(/_/g, " ");
}

function channelLabel(platform: string | null): string | null {
  if (!platform) return null;
  return connector(platform)?.name ?? platform.replace(/_/g, " ");
}

export function OAuthWaitingDialog({
  phase,
  platform,
  attempt,
  onContinueInThisTab,
  onRetry,
  onCancel,
  onOutcome,
}: OAuthWaitingDialogProps) {
  const provider = providerLabel(platform);
  const channel = channelLabel(platform);
  const open = isWaitingPhase(phase);

  // Hand the outcome over exactly once per finished attempt. Without the
  // guard a re-render after the parent stores the result would deliver it
  // again, and a page that opens a picker on it would open two.
  const delivered = useRef<string | null>(null);
  useEffect(() => {
    if (!isTerminalPhase(phase)) {
      delivered.current = null;
      return;
    }
    const key = `${phase}:${attempt?.attemptId ?? "none"}`;
    if (delivered.current === key) return;
    delivered.current = key;
    onOutcome(attempt, phase);
  }, [phase, attempt, onOutcome]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape and the close button mean "stop waiting", which is a
        // cancellation of this click and not of the authorization itself --
        // nothing has been saved either way.
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        // Focus lands on the primary control rather than the close button, so
        // a keyboard user meets the action before the dismissal.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const content = event.currentTarget as HTMLElement;
          const target = content.querySelector<HTMLElement>("[data-autofocus]") ?? content;
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phase === "popup_blocked" ? (
              <ShieldAlert className="size-4 shrink-0 text-muted-foreground" />
            ) : phase === "popup_closed" ? (
              <XCircle className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            )}
            {phase === "popup_blocked"
              ? "Your browser blocked the sign-in window"
              : phase === "popup_closed"
                ? "The sign-in window closed"
                : `Waiting for ${provider}…`}
          </DialogTitle>
          <DialogDescription asChild>
            {/* One live region for the whole dialog: a screen reader hears the
                phase change without the dialog being re-announced. */}
            <p role="status" aria-live="polite">
              {phase === "popup_blocked"
                ? `Flas tried to open ${provider} in a small window and the browser stopped it. You can continue in this tab instead — you will come straight back here afterwards.`
                : phase === "popup_closed"
                  ? `The window went away before ${provider} confirmed anything. Nothing was saved${channel ? `, so there is no half-connected ${channel}` : ""}.`
                  : `Finish signing in to ${provider} in the window that just opened${channel ? `, and Flas will connect ${channel} the moment it is done` : ""}. You do not need to come back here yourself.`}
            </p>
          </DialogDescription>
        </DialogHeader>

        {phase === "waiting" || phase === "opening" ? (
          <p className="text-xs text-muted-foreground">
            Keep this tab open. If you cannot see the sign-in window, it may be behind this one.
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          {phase === "popup_blocked" ? (
            <Button data-autofocus onClick={onContinueInThisTab} className="gap-1.5">
              <ExternalLink className="size-3.5" /> Continue in this tab
            </Button>
          ) : null}
          {phase === "popup_closed" ? (
            <Button data-autofocus onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <Button
            variant="ghost"
            onClick={onCancel}
            {...(phase === "waiting" || phase === "opening" ? { "data-autofocus": true } : {})}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
