import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getSocialHub,
  sendSocialReply,
  suggestSocialReply,
  updateInteractionStatus,
} from "@/lib/social.functions";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { repliesFor, replyDelivery } from "@/lib/social-thread";
import { groupThreads, threadMatches, threadStatus } from "@/lib/social-threads";
import {
  Archive,
  AtSign,
  Check,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Interaction = {
  id: string;
  account_id: string;
  kind: "comment" | "dm";
  direction: "in" | "out";
  author_name: string | null;
  author_handle: string | null;
  body: string;
  status: "open" | "replied" | "archived";
  ai_suggestion: string | null;
  created_at: string;
  external_id?: string | null;
  replied_at?: string | null;
};

type Account = { id: string; platform: string; label: string };

const KIND_FILTERS = ["all", "dm", "comment"] as const;
const STATUS_FILTERS = ["open", "replied", "archived", "all"] as const;

/** Social DMs and comments handled inside the unified inbox. */
export function SocialInbox() {
  const qc = useQueryClient();
  const load = useServerFn(getSocialHub);
  const suggest = useServerFn(suggestSocialReply);
  const send = useServerFn(sendSocialReply);
  const setStatus = useServerFn(updateInteractionStatus);

  const hub = useQuery({
    queryKey: ["social_hub_inbox"],
    queryFn: () => load({}),
    refetchInterval: 30_000,
  });

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<(typeof KIND_FILTERS)[number]>("all");
  const [status, setStatus_] = useState<(typeof STATUS_FILTERS)[number]>("open");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const accounts = (hub.data?.accounts ?? []) as Account[];
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const all = (hub.data?.interactions ?? []) as Interaction[];

  // One row per conversation. Listing every message separately showed a single
  // customer four times over and a thread view with one bubble in it.
  const threads = useMemo(
    () =>
      groupThreads(all)
        .filter((t) => (kind === "all" ? true : t.latest.kind === kind))
        .filter((t) => (status === "all" ? true : threadStatus(t) === status))
        .filter((t) => threadMatches(t, search)),
    [all, kind, status, search],
  );

  const active = threads.find((t) => t.key === activeId) ?? null;
  /**
   * The customer message a reply answers — never one of our own. Falling back
   * to the newest message of either side meant a thread holding only our own
   * messages offered to reply to, draft an answer to, and archive our own words.
   */
  const activeInbound = active?.latestInbound ?? null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["social_hub_inbox"] });
    void qc.invalidateQueries({ queryKey: ["social_hub"] });
  };

  const draft = useMutation({
    mutationFn: (id: string) => suggest({ data: { id } }),
    onSuccess: (res) => {
      setReply(res.suggestion);
      toast.success("Flas AI drafted a reply");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = useMutation({
    mutationFn: () => {
      if (!activeInbound) throw new Error("Pick a message first");
      if (!reply.trim()) throw new Error("Write a reply first");
      return send({ data: { id: activeInbound.id, reply: reply.trim() } });
    },
    onSuccess: (res) => {
      setReply("");
      toast.success(
        res.metaDelivered
          ? "Reply published"
          : "Saved in FLAS, but not sent: Messenger replies aren't available yet. Reply from Facebook for now.",
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: (id: string) => setStatus({ data: { id, status: "archived" } }),
    onSuccess: () => {
      setActiveId(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-0 flex-1">
      <div
        className={cn(
          "w-full shrink-0 flex-col border-e bg-card lg:flex lg:max-w-sm",
          active ? "hidden" : "flex",
        )}
      >
        <div className="space-y-3 border-b p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9"
              placeholder="Search DMs and comments"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {KIND_FILTERS.map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  kind === k
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-secondary",
                )}
              >
                {k === "all" ? "All" : k === "dm" ? "DMs" : "Comments"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatus_(s)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
                  status === s
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-secondary",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {hub.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading social messages…</p>
          ) : accounts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Connect a social account in the Social Hub to see DMs and comments here.
            </p>
          ) : threads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nothing here — try another filter or sync your accounts.
            </p>
          ) : (
            threads.map((t) => {
              const head = t.latestInbound ?? t.latest;
              const acc = accountById.get(t.latest.account_id);
              const state = threadStatus(t);
              return (
                <button
                  key={t.key}
                  onClick={() => {
                    setActiveId(t.key);
                    setReply(head.ai_suggestion ?? "");
                  }}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b p-4 text-start transition-colors hover:bg-muted/60",
                    activeId === t.key && "bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {head.author_name ?? head.author_handle ?? "Unknown"}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(t.latest.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {/* Whose line this is matters: the last word in a thread is
                        often ours, and reading it as the customer's is what made
                        answered conversations look unanswered. */}
                    {t.latest.direction === "out" ? "You: " : ""}
                    {t.latest.body}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Badge variant="secondary" className="gap-1 text-[10px] capitalize">
                      {t.latest.kind === "dm" ? (
                        <MessageSquare className="size-3" />
                      ) : (
                        <AtSign className="size-3" />
                      )}
                      {t.latest.kind === "dm" ? "DM" : "Comment"}
                    </Badge>
                    {acc ? (
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {acc.platform}
                      </Badge>
                    ) : null}
                    {t.items.length > 1 ? (
                      <Badge variant="outline" className="text-[10px]">
                        {t.items.length} messages
                      </Badge>
                    ) : null}
                    {state === "open" ? (
                      <Badge className="bg-brand text-brand-foreground text-[10px]">Waiting</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {state}
                      </Badge>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {!active ? (
        <div className="hidden flex-1 place-items-center text-sm text-muted-foreground lg:grid">
          Select a DM or comment to reply
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate font-semibold">
                {activeInbound?.author_name ??
                  activeInbound?.author_handle ??
                  active.latest.author_name ??
                  active.latest.author_handle ??
                  "Unknown"}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {accountById.get(active.latest.account_id)?.platform ?? "social"} ·{" "}
                {active.latest.kind === "dm" ? "Direct message" : "Comment"} · {active.items.length}{" "}
                message{active.items.length === 1 ? "" : "s"} ·{" "}
                {new Date(active.latest.created_at).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setActiveId(null)}>
                Back
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => activeInbound && archive.mutate(activeInbound.id)}
                disabled={archive.isPending || !activeInbound}
              >
                <Archive className="size-4" /> Archive
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {/* The whole conversation, oldest first, both sides. It used to show
                one customer message plus whatever replies a marker matched, so a
                thread with history read as a single unanswered question. */}
            {active.items.map((i) =>
              i.direction === "out" ? (
                <div key={i.id} className="ms-auto max-w-[75%] space-y-1">
                  <div className="rounded-2xl rounded-se-sm border border-primary/15 bg-primary/10 p-3 text-sm leading-relaxed">
                    {i.body}
                  </div>
                  <p className="px-1 text-end text-[11px] text-muted-foreground">
                    {i.author_name ?? "You"} · {new Date(i.created_at).toLocaleString()}
                  </p>
                </div>
              ) : (
                <div key={i.id} className="max-w-[75%] space-y-1">
                  <div className="rounded-2xl rounded-ss-sm border bg-card p-3 text-sm leading-relaxed">
                    {i.body}
                  </div>
                  <p className="px-1 text-[11px] text-muted-foreground">
                    {i.author_name ?? "Customer"} · {new Date(i.created_at).toLocaleString()}
                  </p>
                </div>
              ),
            )}
            {/* A reply this app sent is matched by its marker: it carries no
                provider conversation id until the platform echoes it back. */}
            {activeInbound
              ? repliesFor(activeInbound, all)
                  .filter((r) => !active.items.some((i) => i.id === r.id))
                  .map((i) => {
                    const delivery = replyDelivery(i);
                    return (
                      <div key={i.id} className="ms-auto max-w-[75%] space-y-1">
                        <div className="rounded-2xl rounded-se-sm border border-primary/15 bg-primary/10 p-3 text-sm leading-relaxed">
                          {i.body}
                        </div>
                        <p className="px-1 text-end text-[11px] text-muted-foreground">
                          You · {new Date(i.created_at).toLocaleString()}
                          {delivery === "sent" ? " · Sent" : ""}
                          {delivery === "not_sent"
                            ? " · Saved in FLAS, not sent. Reply from the platform for now."
                            : ""}
                        </p>
                      </div>
                    );
                  })
              : null}
            {threadStatus(active) === "replied" ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="size-3.5" /> Replied
              </p>
            ) : null}
          </div>

          <div className="space-y-2 border-t bg-card p-4">
            {/* Nothing to answer: every message here is one of ours. Replying
                would name our own message as the one being answered. */}
            {!activeInbound ? (
              <p className="text-xs text-muted-foreground">
                Nothing to reply to — this conversation holds only messages you sent. It will accept
                a reply once the customer writes back.
              </p>
            ) : null}
            <Textarea
              rows={3}
              placeholder="Write your reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={!activeInbound}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => activeInbound && draft.mutate(activeInbound.id)}
                disabled={draft.isPending || !activeInbound}
              >
                {draft.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Flas AI reply
              </Button>
              <Button
                size="sm"
                onClick={() => submit.mutate()}
                disabled={submit.isPending || !activeInbound}
              >
                {submit.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Send reply
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
