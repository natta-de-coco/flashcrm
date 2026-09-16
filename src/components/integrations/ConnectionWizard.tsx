// Guided access & grant wizard. Walks the owner through account prerequisites,
// the exact permission screen, what review the platform requires and how long
// it takes — then hands off to the secure login in a real browser tab.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { connector } from "@/lib/connections-catalog";
import { troubleshooting, type ConnectionStatus } from "@/lib/connection-status";
import { CredentialsStep } from "@/components/integrations/CredentialsStep";
import { credentialSpec, OAUTH_REDIRECT_PATH, setupGuide } from "@/lib/connection-setup";
import { CONNECTORS } from "@/lib/connections-catalog";
import { providerSetup } from "@/lib/provider-setup-links";
import {
  CAPABILITY_LABELS,
  advertisableCapabilities,
  connectorDefinition,
} from "@/lib/social-connector-definitions";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Step = "prepare" | "verify" | "credentials" | "permissions" | "connect" | "errors";

// Credentials sits between knowing what you need and running the login,
// because that is the order the work actually happens in. Channels with no
// keys to paste (an OAuth family already configured) skip it entirely.
const ALL_STEPS: Step[] = ["prepare", "verify", "credentials", "permissions", "connect", "errors"];
const STEP_TITLE: Record<Step, string> = {
  prepare: "Prepare the account",
  verify: "Verify you're ready",
  credentials: "Enter your keys",
  permissions: "Permissions & review",
  connect: "Connect securely",
  errors: "Common errors & quick fixes",
};

export function ConnectionWizard({
  platformId,
  status,
  open,
  onOpenChange,
  onConnect,
  connecting,
  openAt,
}: {
  platformId: string;
  status: ConnectionStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: () => void;
  connecting: boolean;
  /** Jump straight to a step. "Add app keys" should land on the form, not on
   *  page one of a guide the user has to click through. */
  openAt?: Step;
}) {
  const meta = connector(platformId);
  const guide = setupGuide(platformId);
  const definition = connectorDefinition(platformId);
  const trouble = troubleshooting(platformId);
  const provider = providerSetup(meta?.provider);
  const [step, setStep] = useState<Step>(openAt ?? "prepare");
  useEffect(() => {
    if (open) setStep(openAt ?? "prepare");
  }, [open, openAt]);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  // One Meta app serves Facebook, Instagram and Threads, so name the siblings
  // rather than letting the same keys look like three separate chores.
  const siblings = useMemo(
    () =>
      meta?.provider
        ? CONNECTORS.filter((c) => c.provider === meta.provider && c.id !== platformId).map(
            (c) => c.name,
          )
        : [],
    [meta?.provider, platformId],
  );
  const spec = useMemo(
    () => credentialSpec(platformId, { provider: meta?.provider ?? null, siblings }),
    [platformId, meta?.provider, siblings],
  );
  const STEP_ORDER = useMemo(
    () => ALL_STEPS.filter((s) => s !== "credentials" || Boolean(spec)),
    [spec],
  );

  const checklist = trouble?.checklist ?? [];
  const doneCount = checklist.filter((item) => ticked[item]).length;
  const progress = useMemo(
    () => Math.round(((STEP_ORDER.indexOf(step) + 1) / STEP_ORDER.length) * 100),
    [step, STEP_ORDER],
  );

  const next = () => {
    const index = STEP_ORDER.indexOf(step);
    setStep(STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)] as Step);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {meta?.name ?? platformId} setup wizard
            <Badge
              variant={
                status.tone === "good"
                  ? "default"
                  : status.tone === "bad"
                    ? "destructive"
                    : "secondary"
              }
            >
              {status.label}
            </Badge>
          </DialogTitle>
          <DialogDescription>{status.reason}</DialogDescription>
        </DialogHeader>

        {provider ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                <UserRoundCog className="size-3.5" /> Owner/admin · one time
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{provider.ownerTask}</p>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                <UsersRound className="size-3.5" /> SMM team · per client/channel
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{provider.connectionTask}</p>
            </div>
          </div>
        ) : null}

        <Progress value={progress} className="h-1.5" />

        <div className="flex flex-wrap gap-1.5">
          {STEP_ORDER.map((s, i) => (
            <Button
              key={s}
              size="sm"
              variant={step === s ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setStep(s)}
            >
              {s === "errors" ? STEP_TITLE[s] : `${i + 1}. ${STEP_TITLE[s]}`}
            </Button>
          ))}
        </div>

        <div className="space-y-4 text-sm">
          {step === "prepare" && (
            <section className="space-y-3">
              <p className="text-muted-foreground">
                Get these in place first — most failed connections are missing one of them.
              </p>
              <ul className="space-y-2">
                {(guide?.requires ?? ["No special requirements for this platform."]).map((item) => (
                  <li key={item} className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              {provider ? (
                <div className="rounded-md border p-3">
                  <p className="font-medium">Official setup shortcuts</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No treasure hunt. These open the provider's own pages for apps, keys,
                    permissions and review.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {provider.links.map((link) => (
                      <Button
                        key={link.id}
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 text-xs"
                      >
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={link.description}
                        >
                          {link.label} <ExternalLink className="size-3" />
                        </a>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              {guide?.steps ? (
                <div className="rounded-md border bg-muted/40 p-3">
                  <p className="mb-1 font-medium">What happens, in order</p>
                  <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
                    {guide.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </section>
          )}

          {step === "verify" && (
            <section className="space-y-3">
              <p className="text-muted-foreground">
                Tick each line once it is true.{" "}
                {checklist.length > 0 ? `${doneCount}/${checklist.length} confirmed.` : ""}
              </p>
              {checklist.length === 0 ? (
                <p>Nothing to verify for this platform — continue to permissions.</p>
              ) : (
                <ul className="space-y-2">
                  {checklist.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Checkbox
                        checked={!!ticked[item]}
                        onCheckedChange={(value) => setTicked({ ...ticked, [item]: !!value })}
                        className="mt-0.5"
                      />
                      <span className={ticked[item] ? "text-muted-foreground line-through" : ""}>
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {step === "credentials" && spec && (
            <section className="space-y-3">
              {provider ? (
                <div className="rounded-md border bg-muted/40 p-3 text-xs">
                  <p className="font-medium">Where are the keys?</p>
                  <p className="mt-1 text-muted-foreground">
                    Open the official provider page below. Copy only the App/Client ID and Secret
                    requested by Flas — never paste user access tokens here.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {provider.links
                      .filter((link) => link.id === "apps" || link.id === "credentials")
                      .map((link) => (
                        <Button
                          key={link.id}
                          asChild
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 text-xs"
                        >
                          <a href={link.url} target="_blank" rel="noreferrer noopener">
                            {link.label} <ExternalLink className="size-3" />
                          </a>
                        </Button>
                      ))}
                  </div>
                </div>
              ) : null}
              <CredentialsStep
                spec={spec}
                platformName={meta?.name ?? platformId}
                redirectUri={origin ? `${origin}${OAUTH_REDIRECT_PATH}` : ""}
                onSaved={next}
              />
            </section>
          )}

          {step === "permissions" && (
            <section className="space-y-3">
              <div>
                <p className="mb-1 font-medium">Permissions Flas will request</p>
                {/* Straight from the registry, which is the same list
                    oauth.server.ts puts in the authorization URL. */}
                {definition && definition.requestedScopes.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {definition.requestedScopes.map((scope) => (
                      <Badge key={scope} variant="secondary" className="font-mono text-[10px]">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    This platform is configured manually inside Flas — no OAuth permissions needed.
                  </p>
                )}
                {definition && definition.requestedScopes.length > 0 && (
                  <div className="mt-2 rounded-md border bg-muted/40 p-3 text-xs">
                    <p className="font-medium">
                      Grant the full Flas permission set shown on the provider screen
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Approve every permission Flas requests for this connector. Do not grant
                      unrelated permissions that Flas did not request. If the provider lets you
                      decline individual scopes, Flas will verify the result and mark only the
                      affected capability unavailable instead of pretending the connection is
                      healthy.
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      These permissions power:{" "}
                      {advertisableCapabilities(definition)
                        .map((cap) => CAPABILITY_LABELS[cap.key].toLowerCase())
                        .join(", ") || "profile access"}
                      .
                    </p>
                  </div>
                )}
              </div>

              {provider ? (
                <div className="flex flex-wrap gap-2">
                  {provider.links
                    .filter(
                      (link) =>
                        link.id === "permissions" || link.id === "review" || link.id === "api",
                    )
                    .map((link) => (
                      <Button
                        key={link.id}
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 text-xs"
                      >
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={link.description}
                        >
                          {link.label} <ExternalLink className="size-3" />
                        </a>
                      </Button>
                    ))}
                </div>
              ) : null}

              {trouble?.reviewTimeline ? (
                <div className="flex gap-2 rounded-md border bg-muted/40 p-3">
                  <Clock className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">Expected review timeline</p>
                    <p className="text-muted-foreground">{trouble.reviewTimeline}</p>
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Redirect URI to whitelist in your provider app:{" "}
                <span className="break-all font-mono">
                  {origin
                    ? `${origin}${OAUTH_REDIRECT_PATH}`
                    : `https://flas.mobidigisol.com${OAUTH_REDIRECT_PATH}`}
                </span>
              </p>
            </section>
          )}

          {step === "connect" && (
            <section className="space-y-3">
              <p className="text-muted-foreground">
                Flas opens the platform's official login in a new browser tab. Your password stays
                with the provider; Flas receives only the OAuth authorization result.
              </p>
              <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
                <li>Press Connect below and sign in on the provider's own page.</li>
                <li>
                  Approve every permission Flas shows. If you manage several assets, choose the
                  right client Page/channel/account.
                </li>
                <li>Return to Flas. The connection is verified before it is shown as healthy.</li>
                <li>
                  If something is missing, Flas should name the exact scope/review/account-type
                  blocker — not the timeless classic “Something went wrong.”
                </li>
              </ol>
              <div className="flex flex-wrap gap-2">
                {meta?.oauth ? (
                  <Button disabled={connecting} onClick={onConnect}>
                    {connecting ? "Opening…" : "Connect securely"}{" "}
                    <ArrowRight className="ml-1 size-4" />
                  </Button>
                ) : null}
                {meta?.manageUrl ? (
                  <Button asChild variant="outline">
                    <a href={meta.manageUrl} target="_blank" rel="noreferrer noopener">
                      Platform settings <ExternalLink className="ml-1 size-3" />
                    </a>
                  </Button>
                ) : null}
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium">Current status</p>
                <p className="text-muted-foreground">{status.reason}</p>
                <p className="mt-1 flex gap-1.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{status.fix}</span>
                </p>
              </div>
            </section>
          )}

          {step === "errors" && (
            <section className="space-y-3">
              {(trouble?.errors ?? []).length === 0 ? (
                <p className="text-muted-foreground">No known platform errors recorded yet.</p>
              ) : (
                trouble?.errors.map((entry) => (
                  <div key={entry.error} className="rounded-md border p-3">
                    <p className="flex items-start gap-2 font-mono text-xs">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                      {entry.error}
                    </p>
                    <p className="mt-1.5 text-muted-foreground">{entry.means}</p>
                    <p className="mt-1 font-medium">Fix: {entry.fix}</p>
                  </div>
                ))
              )}
              {guide?.gotchas?.length ? (
                <div className="rounded-md border bg-muted/40 p-3">
                  <p className="mb-1 font-medium">Platform limits worth knowing</p>
                  <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                    {guide.gotchas.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          )}
        </div>

        <div className="flex justify-between">
          <Button
            variant="ghost"
            onClick={() => setStep(STEP_ORDER[Math.max(STEP_ORDER.indexOf(step) - 1, 0)] as Step)}
            disabled={step === "prepare"}
          >
            Back
          </Button>
          <Button variant="outline" onClick={next} disabled={step === "errors"}>
            Next step
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
