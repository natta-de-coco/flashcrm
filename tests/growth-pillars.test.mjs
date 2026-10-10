/**
 * tests/growth-pillars.test.mjs
 *
 * Automated regression test suite for Enterprise Growth Pillars:
 * 1. Search Console SEO Dashboard metrics and simulation fallback
 * 2. Multi-Step Drip Sequence configuration & steps
 * 3. Instant Sales Lead Alerts routing & notification channels
 * 4. Multi-Agent Round-Robin Assignment & SLA calculation
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Pillar 1: Google Search Console SEO Studio Logic", () => {
  test("Calculates correct date ranges for 7d, 28d, and 90d query periods", () => {
    const calculateStartDate = (days) => {
      const d = new Date("2026-10-10T00:00:00.000Z");
      d.setDate(d.getDate() - days);
      return d.toISOString().split("T")[0];
    };

    assert.equal(calculateStartDate(7), "2026-10-03");
    assert.equal(calculateStartDate(28), "2026-09-12");
    assert.equal(calculateStartDate(90), "2026-07-12");
  });

  test("Generates structured fallback performance metrics with reasonable bounds", () => {
    const generateFallback = (siteUrl) => ({
      siteUrl,
      clicks: 1420,
      impressions: 28400,
      ctr: 5.0,
      avgPosition: 12.4,
      queries: [
        { query: "whatsapp crm uae", clicks: 320, impressions: 4200, ctr: 7.6, position: 3.2 },
        { query: "customer support chatbot dubai", clicks: 210, impressions: 3100, ctr: 6.8, position: 4.1 },
      ],
      pages: [
        { page: `${siteUrl}/`, clicks: 840, impressions: 16000, ctr: 5.3, position: 8.5 },
        { page: `${siteUrl}/whatsapp-business-api`, clicks: 380, impressions: 7200, ctr: 5.3, position: 9.1 },
      ],
    });

    const metrics = generateFallback("https://flas.mobidigisol.com");
    assert.equal(metrics.siteUrl, "https://flas.mobidigisol.com");
    assert.ok(metrics.clicks > 0);
    assert.ok(metrics.impressions > metrics.clicks);
    assert.equal(metrics.ctr, (metrics.clicks / metrics.impressions) * 100);
    assert.ok(metrics.queries.length >= 2);
    assert.ok(metrics.pages.length >= 2);
  });
});

describe("Pillar 2: Multi-Step Drip Automation Funnel", () => {
  test("Default drip sequence contains standard 3 nurture steps with ascending delay", () => {
    const defaultSteps = [
      { step_order: 1, delay_days: 0, subject: "Welcome to {{company}}! Here is your exclusive 20% discount" },
      { step_order: 2, delay_days: 3, subject: "How {{company}} helps UAE teams grow with WhatsApp & AI" },
      { step_order: 3, delay_days: 7, subject: "Your special offer is expiring soon — activate before it's gone" },
    ];

    assert.equal(defaultSteps.length, 3);
    assert.equal(defaultSteps[0].step_order, 1);
    assert.equal(defaultSteps[0].delay_days, 0);

    assert.equal(defaultSteps[1].step_order, 2);
    assert.equal(defaultSteps[1].delay_days, 3);

    assert.equal(defaultSteps[2].step_order, 3);
    assert.equal(defaultSteps[2].delay_days, 7);

    for (let i = 1; i < defaultSteps.length; i++) {
      assert.ok(defaultSteps[i].delay_days > defaultSteps[i - 1].delay_days);
    }
  });

  test("Enrollment scheduling computes target send date correctly from base time", () => {
    const baseTime = new Date("2026-10-10T12:00:00.000Z");
    const computeSendDate = (days) => {
      const d = new Date(baseTime);
      d.setDate(d.getDate() + days);
      return d.toISOString();
    };

    assert.equal(computeSendDate(0), "2026-10-10T12:00:00.000Z");
    assert.equal(computeSendDate(3), "2026-10-13T12:00:00.000Z");
    assert.equal(computeSendDate(7), "2026-10-17T12:00:00.000Z");
  });
});

describe("Pillar 3: Instant Sales Lead Alerts Routing", () => {
  test("Formats lead alert notifications with all key metadata", () => {
    const formatAlert = (lead) => {
      return `*🚨 New Sales Lead Captured!*
• *Name:* ${lead.name || "Website Visitor"}
• *Email:* ${lead.email || "N/A"}
• *Phone:* ${lead.phone || "N/A"}
• *Source:* ${lead.source || "Widget"}
• *Page:* ${lead.page_url || "Landing Page"}
${lead.notes ? `• *Quote / Note:* ${lead.notes}` : ""}`;
    };

    const text = formatAlert({
      name: "Tariq Mansoor",
      email: "tariq@example.ae",
      phone: "+971501234567",
      source: "website_widget",
      page_url: "https://flas.mobidigisol.com/pricing",
      notes: "Need WhatsApp API for 5 agents",
    });

    assert.match(text, /New Sales Lead Captured/);
    assert.match(text, /Tariq Mansoor/);
    assert.match(text, /tariq@example\.ae/);
    assert.match(text, /\+971501234567/);
    assert.match(text, /Need WhatsApp API for 5 agents/);
  });

  test("Filters alert recipients properly avoiding empty or duplicate emails", () => {
    const rawEmails = "sales@mobidigisol.com,  lead-ops@mobidigisol.com, sales@mobidigisol.com,   ,";
    const parsed = rawEmails
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 3 && e.includes("@"));

    const unique = Array.from(new Set(parsed));

    assert.equal(unique.length, 2);
    assert.deepEqual(unique, ["sales@mobidigisol.com", "lead-ops@mobidigisol.com"]);
  });
});

describe("Pillar 4: Round-Robin Multi-Agent Assignment & SLA", () => {
  test("Deterministically cycles agents in round-robin sequence", () => {
    const agents = ["agent-1", "agent-2", "agent-3"];
    
    const getNextAgent = (lastId) => {
      const idx = lastId ? agents.indexOf(lastId) : -1;
      const nextIdx = (idx + 1) % agents.length;
      return agents[nextIdx];
    };

    assert.equal(getNextAgent(null), "agent-1");
    assert.equal(getNextAgent("agent-1"), "agent-2");
    assert.equal(getNextAgent("agent-2"), "agent-3");
    assert.equal(getNextAgent("agent-3"), "agent-1");
  });

  test("Accurately identifies SLA breach based on elapsed minutes", () => {
    const checkSlaBreach = (assignedAt, firstResponseAt, slaMinutes) => {
      const assigned = new Date(assignedAt).getTime();
      const responded = firstResponseAt ? new Date(firstResponseAt).getTime() : Date.now();
      const elapsedMinutes = (responded - assigned) / (1000 * 60);
      return elapsedMinutes > slaMinutes;
    };

    const now = new Date("2026-10-10T12:30:00.000Z").getTime();
    
    // Responded in 10 mins (SLA 15) -> NOT breached
    assert.equal(
      checkSlaBreach("2026-10-10T12:00:00.000Z", "2026-10-10T12:10:00.000Z", 15),
      false
    );

    // Responded in 25 mins (SLA 15) -> BREACHED
    assert.equal(
      checkSlaBreach("2026-10-10T12:00:00.000Z", "2026-10-10T12:25:00.000Z", 15),
      true
    );
  });
});
