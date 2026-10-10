/**
 * src/components/marketing/CampaignBoard.tsx
 *
 * 5-Stage Kanban Visual Email Marketing Campaign Board.
 * Lifecycle stages: Draft -> Scheduled -> In Progress -> Sent | Paused.
 */

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
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useState } from "react";
import { toast } from "sonner";

export type CampaignStatus = "draft" | "scheduled" | "in_progress" | "sent" | "paused";

export interface CampaignItem {
  id: string;
  name: string;
  subject: string;
  body: string;
  template_id?: string | null;
  image_url?: string | null;
  status: CampaignStatus;
  recipients_count: number;
  scheduled_at?: string | null;
  sent_at?: string | null;
  created_at: string;
}

interface CampaignBoardProps {
  campaigns: CampaignItem[];
  isSmtpVerified: boolean;
  audienceCount: number;
}

const STAGES: { id: CampaignStatus; label: string; color: string; badgeVariant: "default" | "secondary" | "outline" }[] = [
  { id: "draft", label: "Drafts", color: "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200", badgeVariant: "secondary" },
  { id: "scheduled", label: "Scheduled", color: "bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300", badgeVariant: "default" },
  { id: "in_progress", label: "In Progress", color: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300", badgeVariant: "default" },
  { id: "sent", label: "Sent / Completed", color: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300", badgeVariant: "default" },
  { id: "paused", label: "Paused", color: "bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300", badgeVariant: "secondary" },
];

export function CampaignBoard({ campaigns, isSmtpVerified, audienceCount }: CampaignBoardProps) {
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignItem | null>(null);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CampaignStatus }) => {
      if ((status === "scheduled" || status === "in_progress") && !isSmtpVerified) {
        throw new Error("Cannot schedule or send campaign without verified tenant SMTP credentials");
      }

      const updateData: any = { status };
      if (status === "scheduled") {
        updateData["scheduled_at"] = new Date().toISOString();
      } else if (status === "sent") {
        updateData["sent_at"] = new Date().toISOString();
      }

      const { error } = await (supabase.from("campaigns") as any).update(updateData).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campaign stage updated");
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

  async function handleSaveCampaign(data: CampaignComposerData, isScheduled?: boolean) {
    const status: CampaignStatus = isScheduled ? "scheduled" : "draft";

    if (editingCampaign) {
      const { error } = await (supabase.from("campaigns") as any)
        .update({
          name: data.name,
          subject: data.subject,
          body: data.body,
          template_id: data.templateId,
          image_url: data.imageUrl,
          attachments: data.attachments as any,
          status,
          recipients_count: audienceCount,
        })
        .eq("id", editingCampaign.id);

      if (error) throw error;
      toast.success("Campaign updated successfully");
    } else {
      const { error } = await (supabase.from("campaigns") as any).insert({
        name: data.name,
        subject: data.subject,
        body: data.body,
        template_id: data.templateId,
        image_url: data.imageUrl,
        attachments: data.attachments as any,
        status,
        recipients_count: audienceCount,
      });

      if (error) throw error;
      toast.success(isScheduled ? "Campaign scheduled successfully" : "Draft campaign saved");
    }

    setEditingCampaign(null);
    void qc.invalidateQueries({ queryKey: ["campaigns"] });
  }

  return (
    <div className="space-y-4">
      {/* Board Top Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-4 rounded-xl border">
        <div>
          <h2 className="text-lg font-bold">Email Campaigns Kanban Board</h2>
          <p className="text-xs text-muted-foreground">
            Manage your campaigns across 5 lifecycle stages. Audience pool: {audienceCount} consented subscribers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isSmtpVerified ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={() => {
                      setEditingCampaign(null);
                      setComposerOpen(true);
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    New Campaign
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                You can draft campaigns now, but SMTP verification in Settings is required before sending.
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              onClick={() => {
                setEditingCampaign(null);
                setComposerOpen(true);
              }}
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
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-purple-600"
                                onClick={() =>
                                  updateStatusMutation.mutate({ id: camp.id, status: "paused" })
                                }
                              >
                                <Pause className="h-3 w-3" />
                              </Button>
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
                              onClick={() => {
                                setEditingCampaign(camp);
                                setComposerOpen(true);
                              }}
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

      {/* Composer Modal */}
      <CampaignComposerModal
        open={composerOpen}
        onOpenChange={(isOpen) => {
          setComposerOpen(isOpen);
          if (!isOpen) setEditingCampaign(null);
        }}
        onSave={handleSaveCampaign}
        isSmtpVerified={isSmtpVerified}
        initialData={
          editingCampaign
            ? {
                name: editingCampaign.name,
                subject: editingCampaign.subject,
                body: editingCampaign.body,
                templateId: editingCampaign.template_id || undefined,
                imageUrl: editingCampaign.image_url || undefined,
              }
            : undefined
        }
      />
    </div>
  );
}
