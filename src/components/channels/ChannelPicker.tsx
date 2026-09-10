// Steps 3-5 of Add Channel (Batch 2A): select, confirm, connected.
//
// The list was discovered on the server at the callback. The browser only
// ever sends back the ids the person ticked; names, avatars and eligibility
// come from the server's copy.
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

  // One channel found and not yet connected: preselect it. Several: nothing is
  // preselected -- an agency must choose deliberately.
  useEffect(() => {
    const list = q.data?.channels ?? [];
    if (list.length === 1 && list[0] && !list[0].alreadyConnected) setSelected([list[0].externalId]);
  }, [q.data]);

  const mutation = useMutation({
    mutationFn: () => connect({ data: { authorizationId, externalIds: selected } }),
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
  const def = connectorDefinition(authorization.platform);
  const name = def?.displayName ?? authorization.platform;
  const preview = def
    ? channelCapabilities(def, authorization.grantedScopes, authorization.requestedScopes)
    : [];

  if (mutation.isSuccess) {
    return (
      <Card className="mt-4 border-primary/40">
        <CardContent className="grid gap-3 pt-6">
          <p className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="size-5 text-brand" />
            {name} connected successfully
          </p>
          <p className="text-sm text-muted-foreground">
            {mutation.data.connected.length} channel
            {mutation.data.connected.length === 1 ? "" : "s"} connected. Recent content and
            statistics are being fetched now.
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

  const signedIn = (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <UserRound className="size-3.5" /> Signed in as{" "}
      <span className="font-medium text-foreground">{authorization.signedInAs ?? "an unnamed account"}</span>
    </p>
  );

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
    return (
      <Card className="mt-4">
        <CardContent className="grid gap-3 pt-6 text-sm">
          {signedIn}
          <p>
            No {name} channel was found for this account. If your channel belongs to a brand or
            company account, sign in again and choose that account on Google&apos;s account screen.
          </p>
          <Button size="sm" className="w-fit" onClick={() => onSignInAgain(authorization.platform)}>
            Use another Google account
          </Button>
        </CardContent>
      </Card>
    );
  }

  const chosen = channels.filter((c) => selected.includes(c.externalId));

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">
          {confirming ? "Confirm the connection" : `Choose ${name} channel${channels.length > 1 ? "s" : ""}`}
        </CardTitle>
        <CardDescription>
          {channels.length === 1
            ? `We found 1 ${name} channel you can manage.`
            : `We found ${channels.length} ${name} channels you can manage. Choose the ones this workspace should manage.`}
        </CardDescription>
        {signedIn}
      </CardHeader>
      <CardContent className="grid gap-3">
        {(confirming ? chosen : channels).map((c) => {
          const on = selected.includes(c.externalId);
          return (
            <label
              key={c.externalId}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${on ? "border-primary/50 bg-primary/5" : ""}`}
            >
              {!confirming && (
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={on}
                  disabled={!c.eligible}
                  onChange={() =>
                    setSelected((s) => (on ? s.filter((x) => x !== c.externalId) : [...s, c.externalId]))
                  }
                />
              )}
              {c.avatarUrl ? (
                <img src={c.avatarUrl} alt="" className="size-10 rounded-full" loading="lazy" />
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
                <p className="mt-1 text-xs text-muted-foreground">
                  Subscribers {fmt(c.metrics.audience)} · Videos {fmt(c.metrics.content)}
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
            <p className="mb-1.5 font-medium">Flas access</p>
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
                  {p.state === "declined" && <span className="text-destructive"> — declined</span>}
                  {p.state === "not_implemented" && (
                    <span className="text-muted-foreground"> — not available in Flas yet</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Connecting failed."}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => onSignInAgain(authorization.platform)}>
            Use another Google account
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
