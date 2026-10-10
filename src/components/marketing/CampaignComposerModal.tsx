/**
 * src/components/marketing/CampaignComposerModal.tsx
 *
 * Professional Email Marketing Campaign Composer Modal.
 * Includes template presets, dynamic merge tags, image attachment & hero image preview,
 * live Desktop & Mobile simulation, and compliance preflight validation.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  BUILT_IN_EMAIL_TEMPLATES,
  substituteMergeTags,
  validateEmailMarketingHtml,
} from "@/lib/email-templates";
import type { CampaignAttachment, EmailTemplate } from "@/types/tenant-email";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileImage,
  ImageIcon,
  Laptop,
  Paperclip,
  Plus,
  Send,
  Smartphone,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export interface CampaignComposerData {
  name: string;
  subject: string;
  body: string;
  templateId?: string | undefined;
  imageUrl?: string | undefined;
  attachments?: CampaignAttachment[] | undefined;
  audienceTag?: string | null | undefined;
}

interface CampaignComposerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: CampaignComposerData, isScheduled?: boolean) => Promise<void>;
  isSmtpVerified: boolean;
  initialData?: Partial<CampaignComposerData> | undefined;
}

export function CampaignComposerModal({
  open,
  onOpenChange,
  onSave,
  isSmtpVerified,
  initialData,
}: CampaignComposerModalProps) {
  const defaultTpl = BUILT_IN_EMAIL_TEMPLATES[0]!;
  const [name, setName] = useState(initialData?.name || "");
  const [subject, setSubject] = useState(initialData?.subject || "");
  const [body, setBody] = useState(initialData?.body || defaultTpl.htmlContent);
  const [templateId, setTemplateId] = useState(initialData?.templateId || defaultTpl.id);
  const [imageUrl, setImageUrl] = useState(
    initialData?.imageUrl || defaultTpl.defaultImageUrl || ""
  );
  const [attachments, setAttachments] = useState<CampaignAttachment[]>(initialData?.attachments || []);
  const [newAttachmentName, setNewAttachmentName] = useState("");
  const [newAttachmentUrl, setNewAttachmentUrl] = useState("");

  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [activeTab, setActiveTab] = useState<"composer" | "preview">("composer");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function applyTemplate(tpl: EmailTemplate) {
    setTemplateId(tpl.id);
    setSubject(tpl.subject);
    setBody(tpl.htmlContent);
    if (tpl.defaultImageUrl) {
      setImageUrl(tpl.defaultImageUrl);
    }
    toast.success(`Loaded "${tpl.name}" template`);
  }

  function insertMergeTag(tag: string) {
    setBody((prev) => prev + " " + tag);
    toast.success(`Inserted ${tag}`);
  }

  function addAttachment() {
    if (!newAttachmentName.trim() || !newAttachmentUrl.trim()) return;
    const item: CampaignAttachment = {
      id: "att_" + Date.now(),
      name: newAttachmentName.trim(),
      url: newAttachmentUrl.trim(),
      type: newAttachmentUrl.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
      size: 1024 * 128,
    };
    setAttachments([...attachments, item]);
    setNewAttachmentName("");
    setNewAttachmentUrl("");
    toast.success("Attachment added");
  }

  function removeAttachment(id: string) {
    setAttachments(attachments.filter((a) => a.id !== id));
  }

  const renderedPreviewHtml = substituteMergeTags(body, {
    name: "Alex Smith",
    company: "Flas CRM",
    discount_code: "WELCOME20",
    image_url: imageUrl || "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1200&auto=format&fit=crop&q=80",
    unsubscribe_url: "#",
    company_url: "#",
  });

  const validation = validateEmailMarketingHtml(body);

  async function handleSave(schedule = false) {
    if (!name.trim()) {
      toast.error("Please provide a campaign name");
      return;
    }
    if (!subject.trim()) {
      toast.error("Please provide an email subject line");
      return;
    }
    if (schedule && !isSmtpVerified) {
      toast.error("Cannot schedule or send without a verified SMTP configuration in Settings.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(
        {
          name: name.trim(),
          subject: subject.trim(),
          body,
          templateId,
          imageUrl,
          attachments,
        },
        schedule
      );
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl">Email Campaign Composer</DialogTitle>
              <DialogDescription>
                Design responsive, mobile-ready emails with templates, image attachments, and dynamic merge tags.
              </DialogDescription>
            </div>
            {!isSmtpVerified && (
              <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mr-1 h-3 w-3" />
                SMTP Unverified
              </Badge>
            )}
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="grid grid-cols-2 mb-4">
            <TabsTrigger value="composer">Edit Campaign & Content</TabsTrigger>
            <TabsTrigger value="preview">Live Preview & Validation</TabsTrigger>
          </TabsList>

          {/* TAB 1: COMPOSER */}
          <TabsContent value="composer" className="space-y-4">
            {/* Quick Template Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                Select Professional Template
              </Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {BUILT_IN_EMAIL_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className={`text-left p-2.5 rounded-lg border text-xs transition-all ${
                      templateId === tpl.id
                        ? "border-emerald-600 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <p className="font-semibold truncate">{tpl.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">{tpl.category}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="campName">Campaign Name (Internal)</Label>
                <Input
                  id="campName"
                  placeholder="e.g. Q4 Black Friday Welcome Blast"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="campSubject">Email Subject Line</Label>
                <Input
                  id="campSubject"
                  placeholder="e.g. Welcome {{name}}! Claim 20% off your first order"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            </div>

            {/* Hero Image URL & Attachments */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="heroImage" className="flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Hero Image URL
                </Label>
                <Input
                  id="heroImage"
                  placeholder="https://... (banner image)"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </div>

              {/* Merge Tags Insertion Bar */}
              <div className="space-y-1.5">
                <Label className="text-xs">Dynamic Merge Tags (Click to Insert)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {["{{name}}", "{{company}}", "{{discount_code}}", "{{unsubscribe_url}}"].map((tag) => (
                    <Button
                      key={tag}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs font-mono"
                      onClick={() => insertMergeTag(tag)}
                    >
                      <Plus className="mr-1 h-2.5 w-2.5" />
                      {tag}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Attachments Section */}
            <div className="rounded-lg border p-3 bg-muted/20 space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" />
                Attached Images & Documents ({attachments.length})
              </Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Attachment label (e.g. Brochure.pdf / Coupon.png)"
                  value={newAttachmentName}
                  onChange={(e) => setNewAttachmentName(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder="File URL (https://...)"
                  value={newAttachmentUrl}
                  onChange={(e) => setNewAttachmentUrl(e.target.value)}
                  className="h-8 text-xs"
                />
                <Button type="button" size="sm" className="h-8 text-xs" onClick={addAttachment}>
                  Attach
                </Button>
              </div>

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {attachments.map((att) => (
                    <Badge key={att.id} variant="secondary" className="flex items-center gap-1 text-xs py-1">
                      <FileImage className="h-3 w-3" />
                      <span>{att.name}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="ml-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Email HTML / Rich Text Body */}
            <div className="space-y-1.5">
              <Label htmlFor="campBody">HTML Body Content</Label>
              <Textarea
                id="campBody"
                rows={10}
                className="font-mono text-xs"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </TabsContent>

          {/* TAB 2: LIVE PREVIEW & VALIDATION */}
          <TabsContent value="preview" className="space-y-4">
            {/* Device Switcher */}
            <div className="flex items-center justify-between bg-muted/40 p-2 rounded-lg">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={previewDevice === "desktop" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setPreviewDevice("desktop")}
                >
                  <Laptop className="mr-1.5 h-3.5 w-3.5" />
                  Desktop (600px)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={previewDevice === "mobile" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setPreviewDevice("mobile")}
                >
                  <Smartphone className="mr-1.5 h-3.5 w-3.5" />
                  Mobile (375px)
                </Button>
              </div>

              <div className="text-xs text-muted-foreground">
                Subject: <span className="font-semibold text-foreground">{substituteMergeTags(subject, { name: "Alex", company: "Flas CRM", discount_code: "WELCOME20" })}</span>
              </div>
            </div>

            {/* Validation & Compliance Alerts */}
            {validation.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <p className="font-semibold flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Compliance Errors:
                </p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {validation.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {validation.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                <p className="font-semibold flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Deliverability Recommendations:
                </p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {validation.warnings.map((warn, i) => (
                    <li key={i}>{warn}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Iframe Live Render Simulation */}
            <div className="flex justify-center p-4 bg-slate-200 dark:bg-slate-900 rounded-xl overflow-hidden border">
              <div
                style={{
                  width: previewDevice === "desktop" ? "600px" : "375px",
                  transition: "width 0.2s ease-in-out",
                }}
                className="bg-white rounded-lg shadow-lg overflow-hidden border"
              >
                <iframe
                  title="Campaign Email Live Preview"
                  srcDoc={renderedPreviewHtml}
                  className="w-full h-[520px] border-none"
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleSave(false)}
            >
              Save as Draft
            </Button>
            <Button
              type="button"
              disabled={isSubmitting || !isSmtpVerified}
              onClick={() => handleSave(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Schedule / Send
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
