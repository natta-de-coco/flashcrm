// Steps 3-5 of Add Channel (Batch 2A, extended for Meta in 2B): select,
// confirm, connected.
//
// The list was discovered on the server at the callback. The browser only ever
// sends back the ids the person ticked; names, avatars and eligibility come
// from the server's copy. One Meta sign-in lists Facebook Pages and linked
// Instagram accounts together, grouped by platform.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { connectChannels, getAuthorizationDiscovery } from "@/lib/channels.functions";
import { channelCapabilities } from "@/lib/social-channel-capabilities";
import { connectorDefinition } from "@/lib/social-connector-definitions";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, CheckCircle2, Circle, Loader2, Minus, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

const fmt = (n: number | null) => (n === null ? "Hidden" : n.toLocaleString());

/** Whose account chooser "Use another account" reopens. */
const PROVIDER_LABEL: Record<string, string> = {
  youtube: "Google",
  facebook: "Facebook",
  instagram: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  twitter: "X",
  pinterest: "Pinterest",
};

const AUDIENCE_LABEL: Record<string, string> = {
  youtube: "Subscribers",
  facebook: "Followers",
  instagram: "Followers",
  linkedin: "Followers",
  tiktok: "Followers",
  twitter: "Followers",
  pinterest: "Followers",
};

/** What the second metric counts, per platform. */
const CONTENT_LABEL: Record<string, string> = {
  youtube: "Videos",
  tiktok: "Videos",
  pinterest: "Pins",
};

export function ChannelPicker({
  authorizationId,
  onDone,
  onSignInAgain,
}: {
  authorizationId: string;
  onDone: () => void;
  onSignInAgain: (platform: string) => void;
}) {
  const discover = useServerFn(getAuthorizationDiscovery);
  const connect = useServerFn(connectChannels);
  const q = useQuery({
    queryKey: ["channel-discovery", authorizationId],
    queryFn: () => discover({ data: { authorizationId } }),
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  // Exactly one connectable channel: preselect it. Several: nothing is
  // preselected -- an agency must choose deliberately, never import them all.
  useEffect(() => {
    const eligible = (q.data?.channels ?? []).filter((c) => c.eligible && !c.alreadyConnected);
    if (eligible.length === 1 && eligible[0]) setSelected([key(eligible[0])]);
  }, [q.data]);

  const mutation = useMutation({
    mutationFn: () =>
      connect({
        data: {
          authorizationId,
          externalIds: (q.data?.channels ?? [])
            .filter((c) => selected.includes(key(c)))
            .map((c) => c.externalId),
        },
      }),
  });

  if (q.isLoading) {
    return (
      <Card className="mt-4">
        <CardContent className="flex items-center gap-2 pt-6 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading the channels this sign-in can manage…
        </CardContent>
      </Card>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6 text-sm text-destructive">
          {q.error instanceof Error ? q.error.message : "Could not load the channel list."}
        </CardContent>
      </Card>
    );
  }

  const { authorization, channels } = q.data;
  const provider = PROVIDER_LABEL[authorization.platform] ?? "the platform";
  const anotherAccount = `Use another ${provider} account`;

  const signedIn = (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <UserRound className="size-3.5" /> Signed in as{" "}
      <span className="font-medium text-foreground">
        {authorization.signedInAs ?? `a ${provider} account`}
      </span>
    </p>
  );

  if (mutation.isSuccess) {
    const n = mutation.data.connected.length;
    return (
      <Card className="mt-4 border-primary/40">
        <CardContent className="grid gap-3 pt-6">
          <p className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="size-5 text-brand" />
            {n} channel{n === 1 ? "" : "s"} connected successfully
          </p>
          <p className="text-sm text-muted-foreground">
            Recent content and statistics are being fetched now.
          </p>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link to="/social">Go to Social Hub</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={onDone}>
              Back to Social Channels
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (authorization.expired || !authorization.active) {
    return (
      <Card className="mt-4">
        <CardContent className="grid gap-3 pt-6 text-sm">
          <p>This channel list has expired. Sign in again to refresh it.</p>
          <Button size="sm" className="w-fit" onClick={() => onSignInAgain(authorization.platform)}>
            Sign in again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (channels.length === 0) {
    const meta = authorization.platform === "facebook" || authorization.platform === "instagram";
    return (
      <Card className="mt-4">
        <CardContent className="grid gap-3 pt-6 text-sm">
          {signedIn}
          <p>
            {meta
              ? "This Facebook account does not manage any Pages Flas can see. A Page is required, and Facebook asks which Pages to share — tick every Page you want Flas to reach."
              : authorization.platform === "linkedin"
                ? "This LinkedIn member has no approved admin role on any Company Page. Ask a Super admin of the Page to add you, then sign in again."
                : authorization.platform === "youtube"
                  ? "No channel was found for this account. If your channel belongs to a brand or company account, sign in again and choose that account on the account screen."
                  : `${provider} did not return an account for this sign-in. Sign in again, or try another account.`}
          </p>
          <Button size="sm" className="w-fit" onClick={() => onSignInAgain(authorization.platform)}>
            {anotherAccount}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Grouped by platform, in a stable order.
  const groups = ["facebook", "instagram", "youtube", "linkedin", "tiktok", "twitter", "pinterest"]
    .map((p) => ({ platform: p, items: channels.filter((c) => c.platform === p) }))
    .filter((g) => g.items.length > 0);
  const chosen = channels.filter((c) => selected.includes(key(c)));

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">
          {confirming ? "Confirm the connection" : "Choose channels"}
        </CardTitle>
        <CardDescription>
          We found {channels.length} channel{channels.length === 1 ? "" : "s"} you can manage.
          Choose the ones this workspace should manage — nothing is connected until you confirm.
        </CardDescription>
        {signedIn}
      </CardHeader>
      <CardContent className="grid gap-5">
        {groups.map((g) => {
          const def = connectorDefinition(g.platform);
          const visible = confirming ? g.items.filter((c) => selected.includes(key(c))) : g.items;
          if (visible.length === 0) return null;
          const selectable = g.items.filter((c) => c.eligible);
          const allOn = selectable.length > 0 && selectable.every((c) => selected.includes(key(c)));
          const preview = def
            ? channelCapabilities(def, authorization.grantedScopes, authorization.requestedScopes)
            : [];
          return (
            <section key={g.platform} className="grid gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {def?.displayName ?? g.platform} ({g.items.length})
                </h3>
                {!confirming && selectable.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSelected((s) =>
                        allOn
                          ? s.filter((x) => !selectable.some((c) => key(c) === x))
                          : [...new Set([...s, ...selectable.map(key)])],
                      )
                    }
                  >
                    {allOn ? "Clear" : "Select all"}
                  </Button>
                )}
              </div>
              {visible.map((c) => {
                const on = selected.includes(key(c));
                return (
                  <label
                    key={key(c)}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${
                      c.eligible ? "cursor-pointer" : "opacity-60"
                    } ${on ? "border-primary/50 bg-primary/5" : ""}`}
                  >
                    {!confirming && (
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        disabled={!c.eligible}
                        onChange={() =>
                          setSelected((s) => (on ? s.filter((x) => x !== key(c)) : [...s, key(c)]))
                        }
                      />
                    )}
                    {c.avatarUrl ? (
                      <img
                        src={c.avatarUrl}
                        alt=""
                        className="size-10 rounded-full"
                        loading="lazy"
                      />
                    ) : (
                      <div className="size-10 rounded-full bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {c.name}{" "}
                        {c.alreadyConnected && (
                          <Badge variant="outline" className="ml-1 text-[10px]">
                            Already connected — will be refreshed
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.handle ? `${c.handle} · ` : ""}
                        {c.accountType} · ID {c.maskedId}
                      </p>
                      {c.linkedTo && (
                        <p className="text-xs text-muted-foreground">
                          Linked to Page: {c.linkedTo.name}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {AUDIENCE_LABEL[c.platform] ?? "Audience"} {fmt(c.metrics.audience)}
                        {c.metrics.content !== null
                          ? ` · ${CONTENT_LABEL[c.platform] ?? "Posts"} ${fmt(c.metrics.content)}`
                          : ""}
                      </p>
                      {!c.eligible && c.ineligibleReason && (
                        <p className="mt-1 text-xs text-destructive">{c.ineligibleReason}</p>
                      )}
                    </div>
                  </label>
                );
              })}
              {confirming && (
                <div className="rounded-lg border p-3 text-xs">
                  <p className="mb-1.5 font-medium">Flas access for {def?.displayName}</p>
                  <ul className="grid gap-1">
                    {preview.map((p) => (
                      <li key={p.key} className="flex items-center gap-1.5">
                        {p.state === "available" ? (
                          <Check className="size-3 text-brand" />
                        ) : p.state === "needs_permission" ? (
                          <Circle className="size-3 text-muted-foreground" />
                        ) : (
                          <Minus className="size-3 text-muted-foreground" />
                        )}
                        {p.label}
                        {p.state === "needs_permission" && (
                          <span className="text-muted-foreground"> — can be enabled later</span>
                        )}
                        {p.state === "declined" && (
                          <span className="text-destructive"> — declined</span>
                        )}
                        {p.state === "not_implemented" && (
                          <span className="text-muted-foreground">
                            {" "}
                            — not available in Flas yet
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}

        {!confirming && groups.some((g) => g.platform === "facebook") && (
          <p className="text-xs text-muted-foreground">
            Only Instagram Business and Creator accounts linked to a Facebook Page appear here —
            Instagram does not let apps connect personal accounts.
          </p>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Connecting failed."}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => onSignInAgain(authorization.platform)}>
            {anotherAccount}
          </Button>
          {confirming ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
                {`Connect ${chosen.length} channel${chosen.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          ) : (
            <Button size="sm" disabled={selected.length === 0} onClick={() => setConfirming(true)}>
              Continue
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Selection key: platform + id, because one Meta sign-in lists two platforms. */
function key(c: { platform: string; externalId: string }) {
  return `${c.platform}:${c.externalId}`;
}
