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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, Slash, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
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
  /**
   * Written by the popup completion page's full-page fallback. A cancellation
   * and an expiry used to arrive as connect_error, which read as "something
   * broke" when in fact nothing had: the person pressed Cancel, or took longer
   * than fifteen minutes.
   */
  connect_cancelled?: string;
  connect_expired?: string;
  /** The attempt id, so a page that wants the full record can look it up. */
  connect_attempt?: string;
  platform?: string;
};

/** Every parameter this component understands, for reading and for clearing. */
const OUTCOME_PARAMS = [
  "connected",
  "connect_blocked",
  "connect_reason",
  "connect_error",
  "connect_detail",
  "connect_help",
  "select_target",
  "connect_cancelled",
  "connect_expired",
  "connect_attempt",
  "platform",
] as const;

/**
 * The outcome as it appears in the address bar.
 *
 * The Social Hub hands this component its route's validated search. The
 * Connection Center declares no search schema at all, so for the full-page
 * fallback -- a browser that blocked the popup, or a provider that replaced
 * the whole tab -- the parameters are read directly instead. That is what lets
 * the result be shown on the page where Connect was actually pressed, without
 * that page needing to know this flow exists.
 */
function readOutcomeFromLocation(): ConnectionOutcomeSearch {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const key of OUTCOME_PARAMS) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out as ConnectionOutcomeSearch;
}

/** Clears the outcome from the URL without a navigation or a reload. */
function stripOutcomeParams() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of OUTCOME_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (!changed) return;
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Connectors whose login can manage several channels and is served by
 * connection-targets.server (TARGET_PLATFORMS there). Meta Pages keep their own
 * picker because Page tokens come with them.
 */
const CHANNEL_PICKER_PLATFORMS: ReadonlySet<string> = new Set([
  "linkedin",
  "google_business",
  "google_analytics",
  "search_console",
  "meta_ads",
]);

const PICKER_NOUN: Record<string, string> = {
  linkedin: "Company Page",
  google_business: "location",
  google_analytics: "GA4 property",
  search_console: "Search Console site",
  meta_ads: "ad account",
};

type Account = {
  id: string;
  platform: string;
  label: string | null;
  external_id?: string | null;
};

export function ConnectionOutcome({
  search,
  accounts = [],
  onChanged,
  onDismiss,
}: {
  /** Omit on a page with no search schema; the address bar is read instead. */
  search?: ConnectionOutcomeSearch | undefined;
  accounts?: Account[] | undefined;
  onChanged?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
}) {
  const qc = useQueryClient();
  const [fromUrl, setFromUrl] = useState<ConnectionOutcomeSearch | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Read after mount, never during render: the server has no address bar, and
  // producing markup on the client that the server did not produce is a
  // hydration mismatch.
  useEffect(() => {
    if (!search) setFromUrl(readOutcomeFromLocation());
  }, [search]);

  const active: ConnectionOutcomeSearch = search ?? fromUrl ?? {};

  // Defaults so the component can be dropped onto a page that knows nothing
  // about this flow: refresh what the connection screens read, and clear the
  // outcome out of the URL on dismissal.
  const handleChanged =
    onChanged ??
    (() => {
      for (const key of ["connections", "social-hub", "connect-social-accounts"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    });
  const handleDismiss =
    onDismiss ??
    (() => {
      setDismissed(true);
      stripOutcomeParams();
    });

  const blocked = active.connect_blocked;
  const errored = active.connect_error;
  const connected = active.connected;
  const cancelled = active.connect_cancelled;
  const expired = active.connect_expired;
  // The callback sends the pending row's id; "1" is what older links carried.
  const needsTarget = Boolean(active.select_target);
  const pendingId =
    active.select_target && active.select_target !== "1" ? active.select_target : null;

  if (dismissed) return null;
  if (!blocked && !errored && !connected && !cancelled && !expired) return null;

  // The account the callback just created, so the picker knows what to act
  // on. By id first: once several channels per platform can be connected, the
  // first row for the platform is often a different, already-pinned one --
  // opening the picker on it listed nothing and failed.
  //
  // The last fallback builds one from the id in the URL. On the Connection
  // Center there is no account list to search, and without this the picker
  // never opened there at all.
  const account = connected
    ? (accounts.find((a) => a.id === pendingId) ??
      accounts.find((a) => a.platform === connected && !a.external_id) ??
      accounts.find((a) => a.platform === connected) ??
      (pendingId ? { id: pendingId, platform: connected, label: null } : null))
    : null;

  if (cancelled || expired) {
    // Deliberately not destructive styling. Nothing failed and nothing was
    // saved -- someone pressed Cancel, or left the consent screen open too
    // long -- and dressing that as an error sends people looking for a fault.
    return (
      <Alert className="mt-4">
        <Slash className="size-4" />
        <AlertTitle>
          {cancelled ? "Sign-in cancelled" : "That sign-in expired before it finished"}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            {cancelled
              ? "Nothing was connected and nothing was saved. Press Connect again whenever you are ready."
              : "Flas holds a connection request open for about fifteen minutes. Press Connect again to start a fresh one."}
          </p>
          <Button size="sm" variant="outline" onClick={handleDismiss}>
            Dismiss
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (blocked) {
    return (
      <Alert variant="destructive" className="mt-4">
        <XCircle className="size-4" />
        <AlertTitle>Couldn&apos;t finish connecting {blocked}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="font-medium">
            {active.connect_reason ?? "The platform did not return a usable authorization."}
          </p>
          {active.connect_detail && <p>{active.connect_detail}</p>}
          {active.connect_help && (
            <a
              className="inline-block text-xs underline underline-offset-2"
              href={active.connect_help}
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
          <Button size="sm" variant="outline" onClick={handleDismiss}>
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
          <p>{FAILURE_COPY[errored] ?? errored}</p>
          <Button size="sm" variant="outline" onClick={handleDismiss}>
            Dismiss
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (needsTarget && account) {
    return CHANNEL_PICKER_PLATFORMS.has(account.platform) ? (
      <ChannelPicker account={account} onChanged={handleChanged} onDismiss={handleDismiss} />
    ) : (
      <TargetPicker account={account} onChanged={handleChanged} onDismiss={handleDismiss} />
    );
  }

  return (
    <ConnectedBanner
      platform={connected as string}
      account={account}
      onChanged={handleChanged}
      onDismiss={handleDismiss}
    />
  );
}

/**
 * The sanitized failure codes, in English.
 *
 * The callback deliberately puts only a code in the URL so a provider's error
 * text -- which routinely quotes the request, and the request carried the token
 * -- never reaches the address bar. Without this table the customer read
 * "token_exchange_failed" and had nothing to do about it. The full problem,
 * with the fix and the link, comes from getConnectAttempt; this is the floor.
 */
const FAILURE_COPY: Record<string, string> = {
  platform_app_missing:
    "This workspace has no app keys for that platform yet. Add them in Connect & setup, then press Connect again.",
  redirect_uri_mismatch:
    "The platform does not recognise Flas's return address. An administrator needs to register it on the platform's app settings.",
  token_exchange_failed:
    "The platform accepted the login but refused to issue an access token. That is usually a wrong app secret, or an app still in development mode.",
  pkce_error:
    "The security check on this sign-in did not match. Press Connect again and finish in the window that opens.",
  scope_rejected:
    "Some of the permissions Flas needs were not granted. Press Connect again and leave every permission switched on.",
  grant_expired: "That sign-in expired before it finished. Press Connect again.",
  state_invalid:
    "Flas could not match that sign-in to a Connect click. Press Connect again and finish in the window that opens.",
  connect_failed:
    "The platform returned an answer Flas could not complete. Nothing was saved — press Connect again.",
};

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
            <Button
              size="sm"
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
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
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="mt-4 border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">Choose which {noun} Flas should manage</CardTitle>
        <CardDescription>
          This login manages more than one. Flas will not guess — pick the one this workspace should
          use. To add another later, connect again and choose it.
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
            <AlertDescription>{(targets.error as Error).message}</AlertDescription>
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
            {choose.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
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
