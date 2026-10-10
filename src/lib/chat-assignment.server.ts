/**
 * src/lib/chat-assignment.server.ts
 *
 * Round-Robin Multi-Agent WhatsApp Chat Assignment & SLA Tracking Engine.
 * Automatically distributes inbound WhatsApp and web conversations evenly
 * across support agents and monitors response-time SLAs.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as any;

export interface AssignmentResult {
  assigned: boolean;
  agentId: string | null;
  agentName?: string | null;
  slaMinutes: number;
}

/**
 * Assigns an incoming conversation to the next available agent via Round-Robin or Least-Busy.
 */
export async function assignConversationToNextAgent(
  tenantId: string,
  conversationId: string
): Promise<AssignmentResult> {
  try {
    // 1. Fetch routing settings
    const { data: routingSettings } = await db
      .from("tenant_chat_routing_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const enabled = routingSettings ? routingSettings.auto_assignment_enabled : true;
    if (!enabled) {
      return { assigned: false, agentId: null, slaMinutes: 15 };
    }

    const mode = routingSettings?.assignment_mode || "round_robin";
    const slaMinutes = routingSettings?.default_sla_minutes || 15;

    // 2. Query active team agents in workspace
    const { data: profiles, error: profErr } = await db
      .from("profiles")
      .select("id, name, email, role")
      .eq("tenant_id", tenantId)
      .in("role", ["agent", "admin", "owner"])
      .order("created_at", { ascending: true });

    if (profErr || !profiles || profiles.length === 0) {
      return { assigned: false, agentId: null, slaMinutes };
    }

    // Filter to designated active agents if specified
    const activeFilter = routingSettings?.active_agent_ids || [];
    const candidates =
      activeFilter.length > 0
        ? profiles.filter((p: any) => activeFilter.includes(p.id))
        : profiles;

    if (candidates.length === 0) {
      return { assigned: false, agentId: null, slaMinutes };
    }

    let selectedAgent = candidates[0]!;

    if (mode === "least_active" && candidates.length > 1) {
      // Find candidate with lowest number of currently open assigned conversations
      const candidateIds = candidates.map((c: any) => c.id);
      const { data: openConvs } = await db
        .from("conversations")
        .select("assigned_to")
        .eq("tenant_id", tenantId)
        .eq("status", "open")
        .in("assigned_to", candidateIds);

      const counts: Record<string, number> = {};
      candidateIds.forEach((id: string) => (counts[id] = 0));
      (openConvs || []).forEach((c: any) => {
        if (c.assigned_to && counts[c.assigned_to] !== undefined) {
          counts[c.assigned_to] = (counts[c.assigned_to] || 0) + 1;
        }
      });

      // Sort candidate by count ascending
      candidates.sort((a: any, b: any) => (counts[a.id] || 0) - (counts[b.id] || 0));
      selectedAgent = candidates[0]!;
    } else if (candidates.length > 1) {
      // Deterministic Round-Robin
      const lastAssignedId = routingSettings?.last_assigned_agent_id;
      const lastIdx = lastAssignedId ? candidates.findIndex((c: any) => c.id === lastAssignedId) : -1;
      const nextIdx = (lastIdx + 1) % candidates.length;
      selectedAgent = candidates[nextIdx]!;
    }

    const now = new Date().toISOString();

    // 3. Update conversation with assignment
    await db
      .from("conversations")
      .update({
        assigned_to: selectedAgent.id,
        assigned_at: now,
        sla_minutes: slaMinutes,
        sla_breached: false,
      })
      .eq("id", conversationId)
      .eq("tenant_id", tenantId);

    // 4. Update last_assigned_agent_id in settings
    await db
      .from("tenant_chat_routing_settings")
      .upsert(
        {
          tenant_id: tenantId,
          last_assigned_agent_id: selectedAgent.id,
          auto_assignment_enabled: true,
          default_sla_minutes: slaMinutes,
          updated_at: now,
        },
        { onConflict: "tenant_id" }
      );

    return {
      assigned: true,
      agentId: selectedAgent.id,
      agentName: (selectedAgent as any).name || (selectedAgent as any).email,
      slaMinutes,
    };
  } catch (e) {
    console.error("[chat-assignment] Failed to assign conversation:", e);
    return { assigned: false, agentId: null, slaMinutes: 15 };
  }
}

/**
 * Records first outbound response from an agent and evaluates SLA breach.
 */
export async function recordFirstResponseSla(args: {
  tenantId: string;
  conversationId: string;
  senderId?: string | null;
}): Promise<{ recorded: boolean; breached: boolean; responseMinutes: number }> {
  const { tenantId, conversationId } = args;

  const { data: conv } = await db
    .from("conversations")
    .select("assigned_at, first_response_at, sla_minutes, sla_breached")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single();

  const c = conv as any;
  if (!c || c.first_response_at || !c.assigned_at) {
    return { recorded: false, breached: false, responseMinutes: 0 };
  }

  const assignedTime = new Date(c.assigned_at).getTime();
  const now = Date.now();
  const responseMinutes = Math.round((now - assignedTime) / 60000);
  const slaMax = c.sla_minutes || 15;
  const breached = responseMinutes > slaMax;

  await db
    .from("conversations")
    .update({
      first_response_at: new Date(now).toISOString(),
      sla_breached: breached,
    })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId);

  return { recorded: true, breached, responseMinutes };
}
