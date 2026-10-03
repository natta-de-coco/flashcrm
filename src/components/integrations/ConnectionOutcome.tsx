import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getConnectionTargets,
  getMetaTargets,
  selectConnectionTarget,
  selectMetaTarget,
  testSocialConnection,
} from "@/lib/social-doctor.functions";
import { CONNECTORS } from "@/lib/connections-catalog";
import { outcomeCopy } from "@/lib/oauth-outcome";
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
  account_id?: string;
  connect_blocked?: string;
  connect_reason?: string;
  connect_error?: string;
  connect_detail?: string;
  connect_help?: string;
  select_target?: string;
  /** The platform whose sign-in the person cancelled. */
  connect_cancelled?: string;
  /** Why sign-in did not finish: expired, incomplete or provider_refused. */
  connect_code?: string;
  /** The platform a failed sign-in was for. */
  connect_platform?: string;
};

/**
 * A platform id from the URL, as a name. Only known connector ids are shown;
 * anything else reads as "the provider", so a crafted link cannot put its own
 * words on this screen.
 */
function platformName(id: string | undefined): string {
  return CONNECTORS.find((c) => c.id === id)?.name ?? "the provider";
}

/**
 * Connectors whose login can manage several channels and is served by
 * connection-targets.server (TARGET_PLATFORMS there). Meta Pages keep their own
 * picker because Page tokens come with them.
 */
const CHANNEL_PICKER_PLATFORMS: ReadonlySet<string> = new Set([
  "youtube",
  "linkedin",
  "google_business",
  "google_analytics",
  "search_console",
  "meta_ads",
]);

const PICKER_NOUN: Record<string, string> = {
  youtube: "YouTube channel",
  linkedin: "Company Page",
  google_business: "location",
  google_analytics: "GA4 property",
  search_console: "Search Console site",
  meta_ads: "ad account",
};

const PROVIDER_LABEL: Record<string, string> = {
  google_business: "Google Business Profile",
  google_analytics: "Google Analytics",
  search_console: "Google Search Console",
  meta_ads: "Meta Ads",
};

type Account = {
  id: string;
  platform: string;
  label: string | null;
  external_id?: string | null;
};

export function ConnectionOutcome({
  search,
  accounts,
  onChanged,
  onDismiss,
  onRetry,
}: {
  search: ConnectionOutcomeSearch;
  accounts: Account[];
  onChanged: () => void;
  onDismiss: () => void;
  /** Starts sign-in again for a platform, offered after a cancel. */
  onRetry?: ((platform: string) => void) | undefined;
}) {
  const blocked = search.connect_blocked;
  const errored = search.connect_error;
  const connected = search.connected;
  // The callback sends the pending row's id; "1" is what older links carried.
  const needsTarget = Boolean(search.select_target);
  const pendingId =
    search.select_target && search.select_target !== "1" ? search.select_target : null;

  const cancelled = search.connect_cancelled;
  if (!blocked && !errored && !connected && !cancelled) return null;

  if (cancelled) {
    const name = platformName(cancelled);
    const known = CONNECTORS.some((c) => c.id === cancelled);
    return (
      <Alert className="mt-4">
        <AlertTitle>Sign-in to {name} was cancelled</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            Sign-in stopped before FLAS got access, so nothing was connected or changed. You can try
            again whenever you are ready.
          </p>
          <div className="flex flex-wrap gap-2">
            {onRetry && known && (
              <Button size="sm" onClick={() => onRetry(cancelled)}>
                Try again
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // The account the callback just created, so the picker knows what to act
  // on. By id first: once several channels per platform can be connected, the
  // first row for the platform is often a different, already-pinned one --
  // opening the picker on it listed nothing and failed.
  const account = connected
    ? pendingId
      ? (accounts.find((a) => a.id === pendingId && a.platform === connected) ?? null)
      : search.account_id
        ? (accounts.find((a) => a.id === search.account_id && a.platform === connected) ?? null)
        : (accounts.find((a) => a.platform === connected && !a.external_id) ??
          accounts.find((a) => a.platform === connected) ??
          null)
    : null;

  if (blocked) {
    return (
      <Alert variant="destructive" className="mt-4">
        <XCircle className="size-4" />
        <AlertTitle>
          Couldn&apos;t finish connecting {PROVIDER_LABEL[blocked] ?? blocked.replaceAll("_", " ")}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="font-medium">
            {search.connect_reason ?? "The platform did not return a usable authorization."}
          </p>

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
        <AlertTitle>
          {outcomeCopy(search.connect_code, platformName(search.connect_platform)).title}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{outcomeCopy(search.connect_code, platformName(search.connect_platform)).message}</p>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!account)
    return (
      <Alert>
        <AlertTitle>Loading your connection</AlertTitle>
        <AlertDescription>
          Refresh if the account does not appear, or start sign-in again.
        </AlertDescription>
      </Alert>
    );

  if (needsTarget && account) {
    return CHANNEL_PICKER_PLATFORMS.has(account.platform) ? (
      <ChannelPicker account={account} onChanged={onChanged} onDismiss={onDismiss} />
    ) : (
      <TargetPicker account={account} onChanged={onChanged} onDismiss={onDismiss} />
    );
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
    onError: () =>
      toast.error(
        "Could not complete the connection. Please try again or ask a FLAS administrator.",
      ),
  });

  return (
    <Card className="mt-4 border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">Choose which account Flas should manage</CardTitle>
        <CardDescription>Choose the account this workspace should use.</CardDescription>
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
            <AlertDescription>
              {"Could not load your accounts. Try again or ask a FLAS administrator."}
            </AlertDescription>
          </Alert>
        )}

        {targets.data?.diagnosis && (
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertTitle>{targets.data.diagnosis.title}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{targets.data.diagnosis.message}</p>
              {targets.data.diagnosis.steps.length > 0 && (
                <ol className="list-decimal space-y-1 ps-4 text-xs">
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
            aria-pressed={chosen === t.pageId}
            disabled={choose.isPending}
            onClick={() => setChosen(t.pageId)}
            className={`flex w-full items-center gap-3 rounded-lg border p-3 text-start transition ${
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
                {typeof t.followers === "number"
                  ? ` · ${t.followers.toLocaleString()} followers`
                  : ""}
              </p>
            </div>
            {/* Says up front whether posting will work, rather than letting the
                user find out at the moment they try to publish. */}
            <Badge
              variant={t.canPublish ? "secondary" : "outline"}
              className="shrink-0 text-[10px]"
            >
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
            {choose.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : null}
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
    onError: () =>
      toast.error(
        "Could not complete the connection. Please try again or ask a FLAS administrator.",
      ),
  });

  const report = test.data;

  return (
    <Alert className="mt-4">
      <CheckCircle2 className="size-4" />
      <AlertTitle>Connected to {account?.label ?? platform}</AlertTitle>
      <AlertDescription className="space-y-3">
        {!report && (
          <p className="text-sm">
            Your account is connected. Available features depend on the access your provider
            approved.
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
            <Button
              size="sm"
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : null}
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

/**
 * The "which Page / which location?" step for LinkedIn and Business Profile.
 * The list comes from the provider via the server; the choice is checked
 * against it again on the server before anything is saved.
 */
function ChannelPicker({
  account,
  onChanged,
  onDismiss,
}: {
  account: Account;
  onChanged: () => void;
  onDismiss: () => void;
}) {
  const listFn = useServerFn(getConnectionTargets);
  const chooseFn = useServerFn(selectConnectionTarget);
  const [chosen, setChosen] = useState<string | null>(null);
  const noun = PICKER_NOUN[account.platform] ?? "account";

  const targets = useQuery({
    queryKey: ["connection-targets", account.id],
    queryFn: () => listFn({ data: { accountId: account.id } }),
  });

  const choose = useMutation({
    mutationFn: (targetId: string) => chooseFn({ data: { accountId: account.id, targetId } }),
    onSuccess: () => {
      toast.success(`Connected — Flas is now pinned to that ${noun}.`);
      onChanged();
      onDismiss();
    },
    onError: () =>
      toast.error(
        "Could not complete the connection. Please try again or ask a FLAS administrator.",
      ),
  });

  return (
    <Card className="mt-4 border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">Choose which {noun} Flas should manage</CardTitle>
        <CardDescription>
          Choose the account this workspace should use. To add another later, connect again and
          choose it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {targets.isPending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Asking the platform what this login can
            manage…
          </p>
        )}

        {targets.isError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Couldn&apos;t list the available accounts</AlertTitle>
            <AlertDescription>
              {"Could not load your accounts. Try again or ask a FLAS administrator."}
            </AlertDescription>
          </Alert>
        )}

        {targets.data && !targets.data.ok && targets.data.reason && (
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertTitle>The platform did not list any accounts</AlertTitle>
            <AlertDescription>{targets.data.reason}</AlertDescription>
          </Alert>
        )}

        {(targets.data?.targets ?? []).map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={chosen === t.id}
            disabled={choose.isPending}
            onClick={() => setChosen(t.id)}
            className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${
              chosen === t.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.name}</p>
              {t.detail ? (
                <p className="truncate text-xs text-muted-foreground">{t.detail}</p>
              ) : null}
            </div>
          </button>
        ))}

        {targets.data?.ok && targets.data.targets.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This login does not manage any {noun} Flas can connect.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            disabled={!chosen || choose.isPending}
            onClick={() => chosen && choose.mutate(chosen)}
          >
            {choose.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : null}
            Use this {noun}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Later
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Only known, bounded callback fields are accepted. Help URLs are not rendered. */
export function parseConnectionOutcomeSearch(
  search: Record<string, unknown>,
): ConnectionOutcomeSearch {
  const keys = [
    "connected",
    "account_id",
    "connect_blocked",
    "connect_reason",
    "connect_error",
    "select_target",
    "connect_cancelled",
    "connect_code",
    "connect_platform",
  ] as const;
  return Object.fromEntries(
    keys
      .filter((key) => typeof search[key] === "string")
      .map((key) => [key, String(search[key]).slice(0, 300)]),
  );
}
