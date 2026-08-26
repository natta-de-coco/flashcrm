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

  const threads = useMemo(
    () =>
      all
        .filter((i) => i.direction === "in")
        .filter((i) => (kind === "all" ? true : i.kind === kind))
        .filter((i) => (status === "all" ? true : i.status === status))
        .filter((i) => {
          if (!search.trim()) return true;
          const q = search.toLowerCase();
          return (
            i.body.toLowerCase().includes(q) ||
            (i.author_name ?? "").toLowerCase().includes(q) ||
            (i.author_handle ?? "").toLowerCase().includes(q)
          );
        }),
    [all, kind, status, search],
  );

  const active = threads.find((t) => t.id === activeId) ?? null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["social_hub_inbox"] });
    void qc.invalidateQueries({ queryKey: ["social_hub"] });
  };

  const draft = useMutation({
    mutationFn: (id: string) => suggest({ data: { id } }),
    onSuccess: (res) => {
      setReply(res.suggestion);
      toast.success("Flash AI drafted a reply");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = useMutation({
    mutationFn: () => {
      if (!active) throw new Error("Pick a message first");
      if (!reply.trim()) throw new Error("Write a reply first");
      return send({ data: { id: active.id, reply: reply.trim() } });
    },
    onSuccess: (res) => {
      setReply("");
      toast.success(res.metaDelivered ? "Reply published" : "Reply saved to the thread");
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
          "w-full shrink-0 flex-col border-r bg-card lg:flex lg:max-w-sm",
          active ? "hidden" : "flex",
        )}
      >
        <div className="space-y-3 border-b p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
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
              const acc = accountById.get(t.account_id);
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveId(t.id);
                    setReply(t.ai_suggestion ?? "");
                  }}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b p-4 text-left transition-colors hover:bg-muted/60",
                    activeId === t.id && "bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {t.author_name ?? t.author_handle ?? "Unknown"}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{t.body}</span>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Badge variant="secondary" className="gap-1 text-[10px] capitalize">
                      {t.kind === "dm" ? (
                        <MessageSquare className="size-3" />
                      ) : (
                        <AtSign className="size-3" />
                      )}
                      {t.kind === "dm" ? "DM" : "Comment"}
                    </Badge>
                    {acc ? (
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {acc.platform}
                      </Badge>
                    ) : null}
                    {t.status === "open" ? (
                      <Badge className="bg-brand text-brand-foreground text-[10px]">Waiting</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {t.status}
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
                {active.author_name ?? active.author_handle ?? "Unknown"}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {accountById.get(active.account_id)?.platform ?? "social"} ·{" "}
                {active.kind === "dm" ? "Direct message" : "Comment"} ·{" "}
                {new Date(active.created_at).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setActiveId(null)}>
                Back
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => archive.mutate(active.id)}
                disabled={archive.isPending}
              >
                <Archive className="size-4" /> Archive
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm border bg-card p-3 text-sm">
              {active.body}
            </div>
            {all
              .filter(
                (i) =>
                  i.direction === "out" &&
                  i.account_id === active.account_id &&
                  i.kind === active.kind &&
                  new Date(i.created_at) >= new Date(active.created_at),
              )
              .slice(0, 5)
              .reverse()
              .map((i) => (
                <div
                  key={i.id}
                  className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-primary p-3 text-sm text-primary-foreground"
                >
                  {i.body}
                </div>
              ))}
            {active.status === "replied" ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="size-3.5" /> Replied
              </p>
            ) : null}
          </div>

          <div className="space-y-2 border-t bg-card p-4">
            <Textarea
              rows={3}
              placeholder="Write your reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => draft.mutate(active.id)}
                disabled={draft.isPending}
              >
                {draft.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Flash AI reply
              </Button>
              <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}>
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
