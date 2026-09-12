import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ConnectionProblem, ProblemOwner } from "@/lib/connection-problem";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  ExternalLink,
  Info,
  RotateCw,
  XCircle,
} from "lucide-react";

export type ConnectionProblemCardProps = {
  /** Already filtered for the current viewer by connection-problem's forAudience() -- this component renders exactly what it is given. */
  problem: ConnectionProblem;
  /** Shown in the owner line when problem.owner is "PROVIDER", e.g. "Meta", "Google". Falls back to generic wording when absent. */
  providerName?: string | undefined;
  /** Renders the Retry button. Only shown when this is present AND problem.retryable is true. */
  onRetry?: (() => void) | undefined;
  /** Reveals problem.technical behind a disclosure. Off by default: technical detail is for administrators who opted in, never shown to a customer by accident. */
  showTechnical?: boolean | undefined;
  /** Tight one-or-two-line layout for a list/table row instead of the full card. */
  compact?: boolean | undefined;
  className?: string | undefined;
};

function ownerLine(owner: ProblemOwner, providerName: string | undefined): string {
  switch (owner) {
    case "END_USER":
      return "You can fix this";
    case "WORKSPACE_ADMIN":
      return "Your workspace administrator needs to act";
    case "FLAS_ADMIN":
      return "Your Flas administrator needs to finish setup";
    case "PROVIDER":
      return providerName ? `Waiting on ${providerName}` : "Waiting on the provider";
  }
}

const SEVERITY_ICON: Record<ConnectionProblem["severity"], typeof AlertTriangle> = {
  blocking: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_ICON_TONE: Record<ConnectionProblem["severity"], string> = {
  blocking: "text-destructive",
  warning: "text-amber-500",
  info: "text-muted-foreground",
};

/**
 * Renders one connection problem: WHAT happened, WHO has to act, and WHAT's
 * next. Never renders a raw error object or stack trace -- every field it
 * reads is one of ConnectionProblem's plain-English strings.
 */
export function ConnectionProblemCard({
  problem,
  providerName,
  onRetry,
  showTechnical,
  compact,
  className,
}: ConnectionProblemCardProps) {
  const role = problem.severity === "blocking" ? "alert" : "status";
  const Icon = SEVERITY_ICON[problem.severity];
  const owner = ownerLine(problem.owner, providerName);

  const retry = problem.retryable ? onRetry : undefined;
  const link = problem.url && problem.urlLabel ? { url: problem.url, label: problem.urlLabel } : null;
  const copy = problem.copyValue
    ? { value: problem.copyValue, label: problem.copyLabel ?? "Copy" }
    : null;
  const hasActions = Boolean(retry || link || copy);

  const technical = showTechnical ? problem.technical : undefined;
  const hasTechnical = Boolean(technical && (technical.setting || technical.detail));

  if (compact) {
    return (
      <div
        role={role}
        className={cn(
          "flex items-start gap-2 rounded-md border p-2 text-xs",
          problem.severity === "blocking" && "border-destructive/40 bg-destructive/5",
          className,
        )}
      >
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", SEVERITY_ICON_TONE[problem.severity])} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{problem.title}</p>
          <p className="truncate text-muted-foreground">
            {owner} · {problem.nextAction}
          </p>
        </div>
        {hasActions ? (
          <div className="flex shrink-0 items-center gap-1">
            {retry ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label="Retry"
                onClick={retry}
              >
                <RotateCw className="size-3.5" />
              </Button>
            ) : null}
            {link ? (
              <Button asChild type="button" size="icon" variant="ghost" className="size-6">
                <a href={link.url} target="_blank" rel="noopener noreferrer" aria-label={link.label}>
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            ) : null}
            {copy ? <CopyValueButton value={copy.value} label={copy.label} compact /> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Alert
      role={role}
      variant={problem.severity === "blocking" ? "destructive" : "default"}
      className={className}
    >
      <Icon className={cn("size-4", SEVERITY_ICON_TONE[problem.severity])} />
      <AlertTitle>{problem.title}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p className="break-words">{problem.message}</p>
        <p className="text-xs font-medium text-muted-foreground">{owner}</p>
        <p className="break-words text-sm">
          <span className="font-medium">Next: </span>
          {problem.nextAction}
        </p>

        {hasActions ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {retry ? (
              <Button type="button" size="sm" variant="outline" onClick={retry}>
                <RotateCw className="size-3.5" />
                Retry
              </Button>
            ) : null}
            {link ? (
              <Button asChild type="button" size="sm" variant="outline">
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.label}
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            ) : null}
            {copy ? <CopyValueButton value={copy.value} label={copy.label} /> : null}
          </div>
        ) : null}

        {hasTechnical ? (
          <TechnicalDisclosure setting={technical?.setting} detail={technical?.detail} />
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function CopyValueButton({
  value,
  label,
  compact,
}: {
  value: string;
  label: string;
  compact?: boolean | undefined;
}) {
  const [copied, setCopied] = React.useState(false);

  const doCopy = () => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard permission can be denied by the browser; the button
        // simply does not confirm, rather than throwing in the caller's face.
      });
  };

  if (compact) {
    return (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-6"
        aria-label={copied ? "Copied" : label}
        onClick={doCopy}
      >
        <Copy className="size-3.5" />
      </Button>
    );
  }

  return (
    <span aria-live="polite">
      <Button type="button" size="sm" variant="outline" onClick={doCopy}>
        <Copy className="size-3.5" />
        {copied ? "Copied" : label}
      </Button>
    </span>
  );
}

/**
 * Setting name and detail, behind a disclosure so a customer screen (which
 * never gets here -- showTechnical is admin-only) is never the default. Open
 * by default when it renders at all: an administrator who asked for technical
 * detail should see it without a second click, but can still collapse it.
 */
function TechnicalDisclosure({
  setting,
  detail,
}: {
  setting?: string | undefined;
  detail?: string | undefined;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
          <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
          {open ? "Hide technical details" : "Show technical details"}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1 rounded-md border bg-muted/40 p-2 text-xs">
        {setting ? (
          <p>
            <span className="font-medium">Setting:</span> <code className="break-all">{setting}</code>
          </p>
        ) : null}
        {detail ? <p className="break-words">{detail}</p> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
