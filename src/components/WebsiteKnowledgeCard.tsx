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

export function WebsiteKnowledgeCard() {
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
        `Read ${result.pages} pages${result.skipped ? `; ${result.skipped} could not be read` : ""}. The assistant can now use them.`,
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
        <CardTitle className="text-base">Teach the assistant from a website</CardTitle>
        <CardDescription>
          Use public business information in replies. No website login or publishing connection
          needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isAdmin ? (
          <>
            <Label htmlFor="knowledge-website">Public website or page address</Label>
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
              {read.isPending ? "Reading your website…" : "Read website and use in replies"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Reads this page and up to four related pages through FLAS’s website reader
              (Firecrawl). Add only information your business is happy to use with customers. It
              won’t read private pages or sign in.
            </p>
            {knowledge.isSuccess && !knowledge.data.websiteReaderReady && (
              <p className="text-sm">
                Your FLAS admin needs to enable website reading once. You can paste business
                information into the instructions below meanwhile.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm">
            Your workspace admin can add or refresh the website used in replies.
          </p>
        )}
        {knowledge.isError && (
          <p role="alert" className="text-sm text-destructive">
            Website knowledge could not be loaded. Please refresh and try again.
          </p>
        )}
        {knowledge.data?.website && (
          <p className="text-sm">
            {knowledge.data.website.status === "ready"
              ? `${knowledge.data.website.pages} pages ready to use`
              : "Website knowledge is not ready to use"}
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
          Website information is a saved snapshot. Refresh it after changes; live stock, order
          status and prices still need confirmation when the information is missing.
        </p>
      </CardContent>
    </Card>
  );
}
