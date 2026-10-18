import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getOwnProfileSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("full_name")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Your profile is not ready yet. Please retry.");
    return { fullName: data.full_name ?? "" };
  });

export const saveOwnProfileSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({ fullName: z.string().trim().max(120) })
      .strict()
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    // Never accept user ID, role, tenant or email from the caller.
    const { data: saved, error } = await context.supabase
      .from("profiles")
      .update({ full_name: data.fullName || null })
      .eq("id", context.userId)
      .select("full_name")
      .single();
    if (error) throw error;
    if (!saved) throw new Error("Your profile could not be saved.");
    return { fullName: saved.full_name ?? "" };
  });
