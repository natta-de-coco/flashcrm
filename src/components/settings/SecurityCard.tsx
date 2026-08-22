import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** Two-factor authentication (TOTP authenticator app) enrollment and removal. */
export function SecurityCard() {
  const qc = useQueryClient();
  const [enrollId, setEnrollId] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const factors = useQuery({
    queryKey: ["mfa-factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data.totp ?? [];
    },
  });

  const verified = (factors.data ?? []).filter((f) => f.status === "verified");

  const enroll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator app",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setEnrollId(data.id);
      setQrSvg(data.totp.qr_code);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verify = useMutation({
    mutationFn: async () => {
      if (!enrollId) throw new Error("Start enrollment first");
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollId, code });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Two-factor authentication is on");
      setEnrollId(null);
      setQrSvg(null);
      setCode("");
      void qc.invalidateQueries({ queryKey: ["mfa-factors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (factorId: string) => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Two-factor authentication removed");
      void qc.invalidateQueries({ queryKey: ["mfa-factors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Security — two-factor authentication</CardTitle>
        <CardDescription>
          Require a one-time code from an authenticator app (Google Authenticator, 1Password, …) in
          addition to your password when signing in.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center gap-2">
          {verified.length > 0 ? (
            <Badge className="gap-1 bg-brand text-brand-foreground">
              <ShieldCheck className="size-3.5" /> 2FA enabled
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <ShieldOff className="size-3.5" /> 2FA not enabled
            </Badge>
          )}
        </div>

        {verified.map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between rounded-lg border p-3 text-sm"
          >
            <span>{f.friendly_name ?? "Authenticator app"}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => remove.mutate(f.id)}
              disabled={remove.isPending}
            >
              Remove
            </Button>
          </div>
        ))}

        {!enrollId && verified.length === 0 && (
          <div>
            <Button variant="outline" onClick={() => enroll.mutate()} disabled={enroll.isPending}>
              Set up two-factor authentication
            </Button>
          </div>
        )}

        {enrollId && qrSvg && (
          <div className="grid gap-3 rounded-lg border p-3">
            <p className="text-sm">1. Scan this code with your authenticator app:</p>
            <div
              className="w-40 rounded-md bg-white p-2"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="text-sm">2. Enter the 6-digit code it shows:</p>
            <div className="flex gap-2">
              <Input
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                className="w-32"
              />
              <Button
                onClick={() => verify.mutate()}
                disabled={code.length !== 6 || verify.isPending}
              >
                Enable 2FA
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
