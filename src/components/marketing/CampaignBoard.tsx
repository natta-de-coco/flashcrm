/**
 * src/components/marketing/CampaignBoard.tsx
 *
 * 5-Stage Kanban Visual Email Marketing Campaign Board.
 * Lifecycle stages: Draft -> Scheduled -> In Progress -> Sent | Paused.
 */

import { useI18n } from "@/hooks/useI18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CampaignComposerModal,
  type CampaignComposerData,
} from "@/components/marketing/CampaignComposerModal";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/integrations/supabase/client";
import { CAMPAIGN_TOO_LONG } from "@/lib/campaign-audience";
import { saveCampaignDraft } from "@/lib/campaign-audience.functions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dispatchCampaignNow } from "@/lib/marketing.functions";
import type { CampaignAttachment } from "@/types/tenant-email";
import {
  AlertCircle,
  Clock,
  Edit2,
  FileText,
  ImageIcon,
  MoreVertical,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type CampaignStatus = "draft" | "scheduled" | "in_progress" | "sent" | "paused";

export interface CampaignItem {
  id: string;
  name: string;
  subject: string;
  body: string;
  template_id?: string | null;
  image_url?: string | null;
  attachments?: CampaignAttachment[] | null;
  status: CampaignStatus;
  recipients_count: number;
  scheduled_at?: string | null;
  sent_at?: string | null;
  created_at: string;
}

/** A draft written elsewhere on the page (Flas AI), to be opened in the composer. */
export interface CampaignPrefill {
  name: string;
  subject: string;
  body: string;
}

interface CampaignBoardProps {
  campaigns: CampaignItem[];
  isSmtpVerified: boolean;
  /**
   * How many people the audience has, as the server counted it, for the line at
   * the top of the board. Null while that is not known: still being read, or
   * (see `audienceError`) it could not be. It is only shown. A saved campaign
   * records the number the server works out when it saves, never this one.
   */
  audienceCount: number | null;
  /** Why the audience could not be read, when that is the reason it is not known. */
  audienceError?: string | null;
  /** Each new object opens the composer with this draft once. */
  prefill?: CampaignPrefill | null;
}

/** The one write the board makes itself: a stage button on a card. It carries no count. */
interface CampaignsTableClient {
  update: (values: Record<string, unknown>) => {
    eq: (col: string, val: unknown) => Promise<{ error: unknown }>;
  };
}

/**
 * One open composer. It names the campaign it is writing from the moment it
 * opens: a campaign being edited keeps its own id, a new one gets an id now, so
 * every save of this draft, a retry after a refusal or a second click included,
 * is the same campaign. A session also remounts the composer, so it never shows
 * the text of the one before.
 */
interface ComposerSession {
  key: string;
  id: string;
  initial: Partial<CampaignComposerData> | undefined;
}

const STAGES: {
  id: CampaignStatus;
  label: string;
  color: string;
  badgeVariant: "default" | "secondary" | "outline";
}[] = [
  {
    id: "draft",
    label: "Drafts",
    color: "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200",
    badgeVariant: "secondary",
  },
  {
    id: "scheduled",
    label: "Scheduled",
    color: "bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300",
    badgeVariant: "default",
  },
  {
    id: "in_progress",
    label: "In Progress",
    color: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300",
    badgeVariant: "default",
  },
  {
    id: "sent",
    label: "Sent / Completed",
    color: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300",
    badgeVariant: "default",
  },
  {
    id: "paused",
    label: "Paused",
    color: "bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300",
    badgeVariant: "secondary",
  },
];

// Keep disabled until campaign delivery has a real transport and per-recipient evidence.
const EMAIL_CAMPAIGNS_CAN_SEND = false;

export function CampaignBoard({
  campaigns,
  isSmtpVerified,
  audienceCount,
  audienceError,
  prefill,
}: CampaignBoardProps) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [session, setSession] = useState<ComposerSession | null>(null);

  function openComposer(campaign: CampaignItem | null, draft?: CampaignPrefill) {
    setSession({
      key: crypto.randomUUID(),
      id: campaign?.id ?? crypto.randomUUID(),
      initial: campaign
        ? {
            name: campaign.name,
            subject: campaign.subject,
            body: campaign.body,
            templateId: campaign.template_id || undefined,
            imageUrl: campaign.image_url || undefined,
            attachments: campaign.attachments ?? undefined,
          }
        : draft,
    });
  }

  const openedPrefill = useRef<CampaignPrefill | null>(null);
  useEffect(() => {
    if (!prefill || openedPrefill.current === prefill) return;
    openedPrefill.current = prefill;
    openComposer(null, prefill);
  }, [prefill]);

  const saveCampaign = useServerFn(saveCampaignDraft);

  const dispatchNowFn = useServerFn(dispatchCampaignNow);
  const dispatchNowMutation = useMutation({
    mutationFn: async (campaignId: string) => {
      if (!EMAIL_CAMPAIGNS_CAN_SEND) {
        throw new Error(t("marketing.sendingIsNotAutomatedYet"));
      }
      if (!isSmtpVerified) {
        throw new Error("Cannot send broadcast without verified tenant SMTP credentials");
      }
      return await dispatchNowFn({ data: { campaignId } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CampaignStatus }) => {
      if ((status === "scheduled" || status === "in_progress") && !isSmtpVerified) {
        throw new Error(
          "Cannot schedule or send campaign without verified tenant SMTP credentials",
        );
      }

      if (status === "sent") {
        throw new Error(t("marketing.sendingIsNotAutomatedYet"));
      }

      const updateData: Record<string, unknown> = { status };
      if (status === "scheduled") {
        updateData["scheduled_at"] = new Date().toISOString();
      }

      const campaignsTable = supabase.from("campaigns") as unknown as CampaignsTableClient;
      const { error } = await campaignsTable.update(updateData).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { status }) => {
      toast.success(
        status === "scheduled" ? t("marketing.markedAsQueuedFlasCrm") : "Campaign stage updated",
      );
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaigns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campaign deleted");
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  /**
   * Creates or updates the campaign through the server, which counts the
   * audience itself. Says whether it was saved: the composer closes only if so,
   * and otherwise keeps what the person wrote and the id it will be saved under.
   */
  async function handleSaveCampaign(
    data: CampaignComposerData,
    isScheduled?: boolean,
  ): Promise<boolean> {
    if (!session) return false;
    try {
      const result = await saveCampaign({
        data: {
          id: session.id,
          name: data.name,
          subject: data.subject,
          body: data.body,
          templateId: data.templateId,
          imageUrl: data.imageUrl,
          attachments: data.attachments,
          status: isScheduled ? "scheduled" : "draft",
        },
      });
      // `ok: false` means the audience could not be read, so nothing was saved.
      if (!result.ok) {
        toast.error(t("marketing.campaignNotSaved"));
        return false;
      }
      toast.success(
        isScheduled
          ? t("marketing.markedAsQueuedFlasCrm")
          : result.created
            ? t("marketing.campaignSavedAsADraft")
            : "Campaign updated successfully",
      );
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
      return true;
    } catch (e) {
      // A field that got past the form is refused by the server with a code,
      // which is shown as a sentence and not as the validator's own text.
      toast.error(
        e instanceof Error && e.message === CAMPAIGN_TOO_LONG
          ? t("marketing.campaignTooLong")
          : friendlyError(e),
      );
      return false;
    }
  }

  return (
    <div className="space-y-4">
      {/* Board Top Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-4 rounded-xl border">
        <div>
          <h2 className="text-lg font-bold">Email Campaigns Kanban Board</h2>
          <p className="text-xs text-muted-foreground">
            Manage your campaigns across 5 lifecycle stages.{" "}
            {audienceCount !== null
              ? `Audience pool: ${audienceCount} consented subscribers.`
              : audienceError
                ? t("marketing.couldNotCheckWhoHas", { message: audienceError })
                : t("marketing.checkingWhoHasOptedIn")}
          </p>
          {!EMAIL_CAMPAIGNS_CAN_SEND && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {t("marketing.sendingIsNotAutomatedYet")}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isSmtpVerified ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={() => openComposer(null)}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    New Campaign
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                You can draft campaigns now, but SMTP verification in Settings is required before
                sending.
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              onClick={() => openComposer(null)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New Campaign
            </Button>
          )}
        </div>
      </div>

      {/* 5-Column Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const items = campaigns.filter((c) => c.status === stage.id);

          return (
            <div
              key={stage.id}
              className="flex flex-col rounded-xl border bg-muted/20 p-3 min-w-[240px]"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${stage.color}`}>
                  {stage.label}
                </span>
                <span className="text-xs font-semibold text-muted-foreground">{items.length}</span>
              </div>

              {/* Column Cards */}
              <div className="flex-1 space-y-2.5 min-h-[300px]">
                {items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 rounded-lg border border-dashed text-center p-3">
                    <p className="text-xs text-muted-foreground">No {stage.label.toLowerCase()}</p>
                  </div>
                ) : (
                  items.map((camp) => (
                    <Card key={camp.id} className="shadow-sm hover:shadow transition-shadow">
                      <CardHeader className="p-3 pb-2 space-y-1">
                        <div className="flex items-start justify-between gap-1">
                          <CardTitle className="text-xs font-bold line-clamp-1">
                            {camp.name}
                          </CardTitle>
                          {camp.image_url && (
                            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2">
                          {camp.subject}
                        </p>
                      </CardHeader>

                      <CardContent className="p-3 pt-0 space-y-2 text-[11px]">
                        <div className="flex items-center justify-between text-muted-foreground border-t pt-2">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {camp.recipients_count} leads
                          </span>
                          <span className="text-[10px]">
                            {new Date(camp.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        {/* Card Stage Controls */}
                        <div className="flex items-center justify-between gap-1 pt-1 border-t">
                          <div className="flex items-center gap-1">
                            {camp.status === "draft" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 text-emerald-600 hover:text-emerald-700"
                                      disabled={!isSmtpVerified}
                                      onClick={() =>
                                        updateStatusMutation.mutate({
                                          id: camp.id,
                                          status: "scheduled",
                                        })
                                      }
                                    >
                                      <Send className="h-3 w-3" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                {!isSmtpVerified && (
                                  <TooltipContent>Requires verified SMTP</TooltipContent>
                                )}
                              </Tooltip>
                            )}

                            {camp.status === "scheduled" && (
                              <>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 text-emerald-600 hover:text-emerald-700"
                                      disabled={
                                        !EMAIL_CAMPAIGNS_CAN_SEND || dispatchNowMutation.isPending
                                      }
                                      onClick={() => dispatchNowMutation.mutate(camp.id)}
                                    >
                                      <Send className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {t("marketing.sendingIsNotAutomatedYet")}
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 text-purple-600"
                                      onClick={() =>
                                        updateStatusMutation.mutate({
                                          id: camp.id,
                                          status: "paused",
                                        })
                                      }
                                    >
                                      <Pause className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Pause campaign</TooltipContent>
                                </Tooltip>
                              </>
                            )}

                            {camp.status === "in_progress" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-emerald-600 hover:text-emerald-700"
                                    disabled={
                                      !EMAIL_CAMPAIGNS_CAN_SEND || dispatchNowMutation.isPending
                                    }
                                    onClick={() => dispatchNowMutation.mutate(camp.id)}
                                  >
                                    <Send className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("marketing.sendingIsNotAutomatedYet")}
                                </TooltipContent>
                              </Tooltip>
                            )}

                            {camp.status === "paused" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-sky-600"
                                onClick={() =>
                                  updateStatusMutation.mutate({
                                    id: camp.id,
                                    status: "scheduled",
                                  })
                                }
                              >
                                <Play className="h-3 w-3" />
                              </Button>
                            )}

                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => openComposer(camp)}
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                          </div>

                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteCampaignMutation.mutate(camp.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer Modal: one per open session, so each opens with its own text. */}
      {session && (
        <CampaignComposerModal
          key={session.key}
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setSession(null);
          }}
          onSave={handleSaveCampaign}
          isSmtpVerified={isSmtpVerified}
          initialData={session.initial}
        />
      )}
    </div>
  );
}
