import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getMetaTargets,
  selectMetaTarget,
  testSocialConnection,
} from "@/lib/social-doctor.functions";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * What the user sees when they come back from a platform's login page.
 *
 * The OAuth callback has always redirected here with the outcome in the query
 * string — `connect_blocked` + `connect_reason` when the authorization cannot
 * work, `select_target=1` when the login controls more than one Page and the
 * right one has to be chosen. Nothing read those parameters, so a blocked
 * connection landed the user on a page that said nothing at all, and the
 * multi-Page case saved an account with an empty profile and no way to finish.
 * The server was doing the right thing and the screen dropped it.
 */
export type ConnectionOutcomeSearch = {
  connected?: string;
  connect_blocked?: string;
  connect_reason?: string;
  connect_error?: string;
  connect_detail?: string;
  connect_help?: string;
  select_target?: string;
  /** Which platform a connect_error refers to, when the callback knew it. */
  platform?: string;
};

/**
 * The callback redirects with a fixed code, never provider text (Batch 1,
 * Phase 28). Every sentence the user reads is written here. An unknown code
 * gets the generic line rather than being echoed, so a crafted link cannot
 * put arbitrary words on this screen.
 */
const CONNECT_ERROR_COPY: Record<string, string> = {
  callback_invalid:
    "The platform's response was incomplete, so nothing was saved. Start the connection again.",
  oauth_state_expired:
    "This sign-in link expired or was already used. Links last 15 minutes and work once — start the connection again.",
  authorization_cancelled:
    "Authorization was not completed on the platform's screen, so nothing was saved.",
  unsupported_platform: "This platform does not offer a sign-in flow in Flas.",
  platform_app_missing:
    "This platform needs its app keys first. Open Connect & setup → Platform app keys.",
  token_exchange_failed:
    "The platform refused to issue a token. The usual causes are a wrong app secret, a callback URL the platform does not have registered, or an app still in development mode. The Health report names the exact cause.",
  provider_unavailable:
    "The platform is not responding right now. Nothing is wrong with your setup — try again shortly.",
  scope_incomplete:
    "Some permissions were not granted, so the features that need them stay off. Reconnect and leave every permission switched on.",
  callback_error: "The connection could not be completed. The Health report names the exact cause.",
  token_storage_unavailable:
    "Flas cannot store this connection securely yet: token encryption is not configured on this deployment. Nothing was saved.",
};

function connectErrorCopy(code: string, platform?: string): string {
  const copy =
    CONNECT_ERROR_COPY[code] ??
    "The connection did not complete. The Health report names the exact cause.";
  // Shown only when it looks like a platform id; anything else is dropped.
  const name = platform && /^[a-z_]{1,32}$/.test(platform) ? platform.replace(/_/g, " ") : null;
  return name ? `${name}: ${copy}` : copy;
}

type Account = { id: string; platform: string; label: string | null };

export function ConnectionOutcome({
  search,
  accounts,
  onChanged,
  onDismiss,
}: {
  search: ConnectionOutcomeSearch;
  accounts: Account[];
  onChanged: () => void;
  onDismiss: () => void;
}) {
  const blocked = search.connect_blocked;
  const errored = search.connect_error;
  const connected = search.connected;
  const needsTarget = search.select_target === "1";

  if (!blocked && !errored && !connected) return null;

  // The account the callback just created, so the picker knows what to act on.
  const account = connected
    ? (accounts.find((a) => a.platform === connected) ?? null)
    : null;

  if (blocked) {
    return (
      <Alert variant="destructive" className="mt-4">
        <XCircle className="size-4" />
        <AlertTitle>Couldn&apos;t finish connecting {blocked}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="font-medium">
            {search.connect_reason ?? "The platform did not return a usable authorization."}
          </p>
          {search.connect_detail && <p>{search.connect_detail}</p>}
          {search.connect_help && (
            <a
              className="inline-block text-xs underline underline-offset-2"
              href={search.connect_help}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open the page where this is fixed
            </a>
          )}
          <p className="text-xs opacity-80">
            Nothing was saved, so there is no half-connected account to clean up. Fix the cause
            above and press Connect again.
          </p>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (errored) {
    return (
      <Alert variant="destructive" className="mt-4">
        <XCircle className="size-4" />
        <AlertTitle>Connection failed</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{connectErrorCopy(errored, search.platform)}</p>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (needsTarget && account) {
    return <TargetPicker account={account} onChanged={onChanged} onDismiss={onDismiss} />;
  }

  return (
    <ConnectedBanner
      platform={connected as string}
      account={account}
      onChanged={onChanged}
      onDismiss={onDismiss}
    />
  );
}

/**
 * The "which Page?" step. Picking the wrong one — or letting Flas silently take
 * whichever the API returned first — is how a connection ends up green in the
 * UI while reading someone else's Page or nothing at all.
 */
function TargetPicker({
  account,
  onChanged,
  onDismiss,
}: {
  account: Account;
  onChanged: () => void;
  onDismiss: () => void;
}) {
  const targetsFn = useServerFn(getMetaTargets);
  const selectFn = useServerFn(selectMetaTarget);
  const [chosen, setChosen] = useState<string | null>(null);

  const targets = useQuery({
    queryKey: ["meta-targets", account.id],
    queryFn: () => targetsFn({ data: { accountId: account.id } }),
  });

  const choose = useMutation({
    mutationFn: (pageId: string) => selectFn({ data: { accountId: account.id, pageId } }),
    onSuccess: () => {
      toast.success("Connected — Flas is now pinned to that account.");
      onChanged();
      onDismiss();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="mt-4 border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">Choose which account Flas should manage</CardTitle>
        <CardDescription>
          This login controls more than one. Flas will not guess — pick the one this workspace
          should read and post to.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {targets.isPending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Asking the platform what this login can
            reach…
          </p>
        )}

        {targets.isError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Couldn&apos;t list the available accounts</AlertTitle>
            <AlertDescription>{(targets.error as Error).message}</AlertDescription>
          </Alert>
        )}

        {targets.data?.diagnosis && (
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertTitle>{targets.data.diagnosis.title}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{targets.data.diagnosis.message}</p>
              {targets.data.diagnosis.steps.length > 0 && (
                <ol className="list-decimal space-y-1 pl-4 text-xs">
                  {targets.data.diagnosis.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {targets.data.diagnosis.helpUrl && (
                <a
                  className="inline-block text-xs underline underline-offset-2"
                  href={targets.data.diagnosis.helpUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open the page where this is fixed
                </a>
              )}
            </AlertDescription>
          </Alert>
        )}

        {(targets.data?.targets ?? []).map((t) => (
          <button
            key={t.pageId}
            type="button"
            onClick={() => setChosen(t.pageId)}
            className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${
              chosen === t.pageId ? "border-primary bg-primary/5" : "hover:bg-muted/50"
            }`}
          >
            {t.picture ? (
              <img src={t.picture} alt="" className="size-9 rounded-full object-cover" />
            ) : (
              <div className="size-9 rounded-full bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.pageName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t.instagramUsername ? `@${t.instagramUsername} · ` : ""}
                {t.category ?? "Page"}
                {typeof t.followers === "number" ? ` · ${t.followers.toLocaleString()} followers` : ""}
              </p>
            </div>
            {/* Says up front whether posting will work, rather than letting the
                user find out at the moment they try to publish. */}
            <Badge variant={t.canPublish ? "secondary" : "outline"} className="shrink-0 text-[10px]">
              {t.canPublish ? "Can post" : "Read only"}
            </Badge>
          </button>
        ))}

        {targets.data && targets.data.targets.length === 0 && !targets.data.diagnosis && (
          <p className="text-sm text-muted-foreground">
            This login does not control any account Flas can manage.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            disabled={!chosen || choose.isPending}
            onClick={() => chosen && choose.mutate(chosen)}
          >
            {choose.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            Use this account
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Later
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Confirms the connection and offers to prove it works before the user leaves. */
function ConnectedBanner({
  platform,
  account,
  onChanged,
  onDismiss,
}: {
  platform: string;
  account: Account | null;
  onChanged: () => void;
  onDismiss: () => void;
}) {
  const testFn = useServerFn(testSocialConnection);
  const test = useMutation({
    mutationFn: () => testFn({ data: { accountId: account?.id ?? "" } }),
    onSuccess: () => onChanged(),
    onError: (e: Error) => toast.error(e.message),
  });

  const report = test.data;

  return (
    <Alert className="mt-4">
      <CheckCircle2 className="size-4" />
      <AlertTitle>Connected to {platform}</AlertTitle>
      <AlertDescription className="space-y-3">
        {!report && (
          <p className="text-sm">
            Authorization saved. Run a check to confirm what Flas can actually do with it — the
            token being accepted is not the same as the permissions being granted.
          </p>
        )}

        {report && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{report.summary}</p>
            <div className="flex flex-wrap gap-1.5">
              {report.capabilities.map((c) => (
                <Badge
                  key={c.capability}
                  variant={c.permissionState === "granted" ? "secondary" : "outline"}
                  className="text-[10px]"
                >
                  {c.capability}: {c.permissionState}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {account && (
            <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              {report ? "Check again" : "Check what works"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Done
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
