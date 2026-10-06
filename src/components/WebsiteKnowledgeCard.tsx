import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { getBrandKnowledge, syncWebsiteNow } from "@/lib/train.functions";
import { publicKnowledgeUrl } from "@/lib/website-knowledge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";

export function WebsiteKnowledgeCard() {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const { tenant } = useTenant();
  const client = useQueryClient();
  const [address, setAddress] = useState("");
  const knowledge = useQuery({
    queryKey: ["chatbot-website", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: () => getBrandKnowledge(),
  });
  const read = useMutation({
    mutationFn: () => syncWebsiteNow({ data: { siteUrl: publicKnowledgeUrl(address) } }),
    onSuccess: (result) => {
      toast.success(
        t("websiteKnowledgeCard.readPagesTheAssistantCan", {
          pages: result.pages,
          value: result.skipped ? `; ${result.skipped} could not be read` : "",
        }),
      );
      void client.invalidateQueries({ queryKey: ["chatbot-website"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: ["chatbot-website"] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("websiteKnowledgeCard.teachTheAssistantFromA")}
        </CardTitle>
        <CardDescription>
          {t("websiteKnowledgeCard.usePublicBusinessInformationIn")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isAdmin ? (
          <>
            <Label htmlFor="knowledge-website">
              {t("websiteKnowledgeCard.publicWebsiteOrPageAddress")}
            </Label>
            <Input
              id="knowledge-website"
              placeholder="https://your-business.com"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={read.isPending}
            />
            <Button
              onClick={() => read.mutate()}
              disabled={!address.trim() || read.isPending || !knowledge.data?.websiteReaderReady}
            >
              {read.isPending
                ? t("websiteKnowledgeCard.readingYourWebsite")
                : t("websiteKnowledgeCard.readWebsiteAndUseIn")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("websiteKnowledgeCard.readsThisPageAndUp")}
            </p>
            {knowledge.isSuccess && !knowledge.data.websiteReaderReady && (
              <p className="text-sm">{t("websiteKnowledgeCard.yourFlasAdminNeedsTo")}</p>
            )}
          </>
        ) : (
          <p className="text-sm">{t("websiteKnowledgeCard.yourWorkspaceAdminCanAdd")}</p>
        )}
        {knowledge.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("websiteKnowledgeCard.websiteKnowledgeCouldNotBe")}
          </p>
        )}
        {knowledge.data?.website && (
          <p className="text-sm">
            {knowledge.data.website.status === "ready"
              ? t("websiteKnowledgeCard.pagesReadyToUse", { pages: knowledge.data.website.pages })
              : t("websiteKnowledgeCard.websiteKnowledgeIsNotReady")}
            {knowledge.data.website.last_synced_at &&
              ` · Last read ${new Date(knowledge.data.website.last_synced_at).toLocaleString()}`}
          </p>
        )}
        {(knowledge.data?.recentPages ?? []).length > 0 && (
          <ul className="space-y-1 text-sm">
            {knowledge.data!.recentPages.map((page) => (
              <li key={page.id}>{page.title || page.url}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {t("websiteKnowledgeCard.websiteInformationIsASaved")}
        </p>
      </CardContent>
    </Card>
  );
}
