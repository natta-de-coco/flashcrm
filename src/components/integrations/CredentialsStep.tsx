import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { CredentialSpec } from "@/lib/connection-setup";
import { savePlatformApp } from "@/lib/platform-apps.functions";
import { addWhatsAppNumber } from "@/lib/wa-numbers.functions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Collects the values a channel needs, with the instructions for finding each
 * one directly beneath its input.
 *
 * The wizard used to explain what to do and then send the user somewhere else
 * to do it — "open Settings → Numbers and add your permanent token". That hand
 * off is where setup died: by the time you have found the token you have lost
 * the page that told you what it was for. Everything needed to finish now
 * lives on one screen, and Continue stays disabled until it can actually work.
 */
export function CredentialsStep({
  spec,
  platformName,
  redirectUri,
  onSaved,
  continueLabel = "Continue",
}: {
  spec: CredentialSpec;
  platformName: string;
  /** Whitelisting this exact URL is the most common missed step. */
  redirectUri: string;
  onSaved: () => void;
  continueLabel?: string;
}) {
  const qc = useQueryClient();
  const saveApp = useServerFn(savePlatformApp);
  const addNumber = useServerFn(addWhatsAppNumber);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  const value = (k: string) => values[k] ?? "";

  // Every field is required: a half-filled connection fails later, further
  // from the cause, which is worse than refusing to submit now.
  const complete = spec.fields.every((f) => value(f.key).trim().length > 0);

  const save = useMutation({
    mutationFn: async () => {
      if (spec.scope === "provider") {
        await saveApp({
          data: {
            provider: spec.provider as never,
            clientId: value("clientId").trim(),
            clientSecret: value("clientSecret").trim(),
          },
        });
        return;
      }
      // WhatsApp: the credentials belong to one phone number, not to an app.
      // Saved by the server, which encrypts the token and app secret.
      const appSecret = value("app_secret").trim();
      await addNumber({
        data: {
          label: value("label").trim(),
          displayPhone: value("display_phone").trim() || undefined,
          phoneNumberId: value("phone_number_id").trim(),
          accessToken: value("access_token").trim(),
          appSecret: appSecret || undefined,
        },
      });
    },
    onSuccess: () => {
      setSaved(true);
      setValues({});
      toast.success(
        spec.scope === "provider"
          ? "App details saved. Provider sign-in is still needed to connect your account."
          : "Number connected.",
      );
      void qc.invalidateQueries({ queryKey: ["connect-readiness"] });
      void qc.invalidateQueries({ queryKey: ["integration-readiness"] });
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["platform-apps"] });
      void qc.invalidateQueries({ queryKey: ["wa_numbers"] });
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (saved) {
    return (
      <Alert>
        <CheckCircle2 className="size-4" />
        <AlertTitle>Saved</AlertTitle>
        <AlertDescription>
          {spec.scope === "provider"
            ? "Move on to the last step to run the secure login."
            : "Flas can now send and receive on this number."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <section className="space-y-5">
      {spec.scope === "provider" && (
        <>
          <p className="text-muted-foreground">
            These are your own app keys, so {platformName} talks to your business rather than to
            Flas. You enter them once.
          </p>

          {spec.alsoUnlocks && spec.alsoUnlocks.length > 0 && (
            <p className="text-xs text-muted-foreground">
              The same keys also connect{" "}
              <span className="font-medium text-foreground">{spec.alsoUnlocks.join(", ")}</span> —
              you will not be asked again for those.
            </p>
          )}

          {/* Forgetting this is the most common reason a correctly configured
              app still refuses the login, so it is on the same screen. */}
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="mb-1.5 text-xs font-medium">
              First, add this redirect URI to the app you create
            </p>
            <CopyRow value={redirectUri} />
            <p className="mt-1.5 text-xs text-muted-foreground">
              The platform rejects the login unless this exact URL is listed as an authorized
              redirect.
            </p>
          </div>
        </>
      )}

      {spec.fields.map((field, i) => (
        <div key={field.key} className="space-y-2">
          <Label htmlFor={`cred-${field.key}`} className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="size-5 justify-center p-0 text-[10px]">
              {i + 1}
            </Badge>
            {field.label}
          </Label>
          <Input
            id={`cred-${field.key}`}
            type={field.secret ? "password" : "text"}
            value={value(field.key)}
            placeholder={field.placeholder ?? field.label}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => set(field.key, e.target.value)}
          />
          <ul className="ml-1 space-y-1">
            {field.help.map((h) => (
              <li key={h} className="flex gap-2 text-xs text-muted-foreground">
                <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-current" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
          {field.link && (
            <a
              href={field.link.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
            >
              {field.link.label} <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      ))}

      <div className="flex items-center gap-3 border-t pt-4">
        <Button disabled={!complete || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
          {continueLabel}
        </Button>
        {!complete && (
          <span className="text-xs text-muted-foreground">Fill every field above to continue.</span>
        )}
      </div>
    </section>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 text-[11px]">
        {value || "…"}
      </code>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 gap-1 text-xs"
        disabled={!value}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
