import type { DashboardOverview } from "@/lib/dashboard.server";
import { fixtureState } from "./functions";
export const homePreview = { mode: "active", briefCalls: 0 };
export async function getDashboardOverview(): Promise<DashboardOverview> {
  if (fixtureState.fail || homePreview.mode === "error")
    throw new Error("Sample overview unavailable. Retry after changing the preview mode.");
  const empty = homePreview.mode === "empty";
  const trend = { current: empty ? 0 : 18, previous: empty ? 0 : 12, changePct: empty ? null : 50 };
  return {
    stats: {
      open: empty ? 0 : 7,
      unread: empty ? 0 : 5,
      unreadConversations: empty ? 0 : 3,
      contacts: empty ? 0 : 128,
      botReplies: empty ? 0 : 18,
    },
    activity: {
      buckets: Array.from({ length: 7 }, (_, i) => ({
        day: `Oct ${i + 9}`,
        received: empty ? 0 : i + 1,
        sent: empty ? 0 : i + 2,
      })),
      weekTotal: empty ? 0 : 63,
      todayTotal: empty ? 0 : 9,
    },
    trends: { messages: trend, inbound: trend, leads: trend, replies: trend },
    health: {
      score: empty ? 0 : 74,
      grade: empty ? "At risk" : "Good",
      factors: ["responsiveness", "inbox", "pipeline", "social", "consent"].map((key) => ({
        key,
        label: key,
        score: empty ? 0 : 74,
        detail: "Synthetic activity indicator for layout verification.",
      })),
    },
    social: {
      accounts: [],
      pendingTotal: 0,
      pendingPartial: false,
      pendingCounted: 0,
      interactions7d: 0,
      totalAudience: 0,
    },
    recentConversations: empty
      ? []
      : [
          {
            id: `${fixtureState.scope}-chat-0`,
            contactName: "Maya · sample contact",
            preview: "Could we arrange a product demonstration?",
            channel: "whatsapp",
            status: "open",
            unread: 3,
            lastMessageAt: new Date().toISOString(),
          },
        ],
  };
}
export const getDailyBrief = async () => {
  homePreview.briefCalls++;
  return {
    headline: "Sample summary — no AI called",
    summary: "This is a synthetic preview. Open Inbox to see the sample conversations.",
    actions: ["Review the sample unread chats."],
    generatedAt: new Date().toISOString(),
    cached: false,
  };
};
export const getMetaSyncHealth = async () => ({
  numbers: [],
  checkedAt: new Date().toISOString(),
  metaAnalytics: { available: false, reason: "Provider totals are not queried in this preview." },
});
export const logWidgetError = () => {};
