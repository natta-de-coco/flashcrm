# Instruction for Gemini — adding 50 guides to the Flas CRM blog

Copy everything between the two `---` lines into Gemini. It already contains the
file format, the topic list, and the rules that keep the content from getting
the site demoted.

**Do it in five batches of ten, not one batch of fifty.** Ask for batch 1, check
it, then ask for batch 2. A single 50-article response will be rushed, repetitive
and too long to review — and reviewing it is the part that protects you.

---

You are writing long-form guides for the Flas CRM marketing blog. Flas CRM is a
WhatsApp-first CRM for small and mid-sized businesses, built by Mobi Digital
Solutions (Dubai, UAE). It has a shared WhatsApp inbox, an AI chatbot with human
handoff, a social inbox, lead-capture plugins for WordPress and Shopify,
campaigns, an SEO studio, quotations and invoices, and per-company data
isolation. Pricing: one month free, then $20/month for six months instead of
$30, or $240/year instead of $360.

## Where the content goes

Posts live in `src/content/blog.ts` as entries in the exported `POSTS` array.
You append new objects to that array and change nothing else — `/sitemap.xml`,
the blog index and the article pages all read from it automatically.

Every post must match this exact type:

```ts
export type Post = {
  slug: string;          // URL segment, lowercase-hyphenated, NEVER changed later
  title: string;         // the <h1>; do not repeat it inside html
  excerpt: string;       // <=160 chars, used as the meta description
  category: string;      // reuse existing: WhatsApp | Compliance | Lead capture |
                         // Operations | AI | Sales | Guides | Comparison
  published: string;     // "YYYY-MM-DD"
  updated?: string;      // only when revising an existing post
  readingMinutes: number;
  keywords: string[];    // 3-5 real search phrases, lowercase
  html: string;          // body, in a template literal
};
```

Example of the shape (abbreviated):

```ts
  {
    slug: "whatsapp-broadcast-limits-explained",
    title: "WhatsApp broadcast limits, and what actually raises them",
    excerpt:
      "New numbers start capped. Here is what moves your messaging tier, and the mistake that gets it lowered instead.",
    category: "WhatsApp",
    published: "2026-09-15",
    readingMinutes: 6,
    keywords: [
      "whatsapp broadcast limit",
      "whatsapp messaging tier",
      "whatsapp daily message limit",
    ],
    html: `
<p>Opening paragraph, no heading above it.</p>

<h2>A section</h2>

<p>Body text.</p>
`,
  },
```

### Hard formatting rules

- `html` starts at `<h2>` — the page renders the `<h1>` from `title`. Never put
  an `<h1>` in the body.
- Allowed tags only: `p, h2, h3, ul, ol, li, strong, em, a, table, thead, tbody,
  tr, th, td, code, pre, blockquote`. No `div`, no `class`, no inline styles, no
  images, no `<script>`.
- Escape any backtick or `${` inside `html` — it is a JavaScript template
  literal and an unescaped one breaks the build.
- Internal links use root-relative paths: `<a href="/blog/other-slug">`. Link to
  2–4 other posts in every article, and at least once to `/pricing`,
  `/features` or `/whatsapp-business-api` where it is genuinely relevant.
- External links get `rel="nofollow noreferrer" target="_blank"`.
- Use straight ASCII apostrophes in code fields (`slug`, `keywords`), and normal
  typographic punctuation inside `html`.

## Rules that decide whether this ranks or gets penalised

1. **Stagger `published` dates.** Spread them across the next four to five
   months, two or three per week, starting 2026-09-15. Fifty posts sharing one
   date is the clearest possible signal of scaled content generation, which
   Google's spam policy demotes. Do not publish them all at once.

2. **Never invent a fact about a named competitor.** Verified pricing for Wati,
   Respond.io, Zoko, Chatwoot and Twilio is in `docs/competitor-pricing-verified.md`,
   read from each vendor's own page on 2026-09-08. Use only those figures, and
   always state the "verified September 2026" date beside them in the article.

   Interakt and AiSensy base prices are marked LOW CONFIDENCE in that file and
   are **not** verified — do not publish a price for either. If a post needs one,
   leave `[VERIFY: Interakt Growth monthly price — recheck interakt.shop/pricing]`.

   That file also lists what must be conceded about competitors (Chatwoot is
   cheaper for a single agent; Zoko Starter also has unlimited agents; Chatwoot
   is open source; Wati and Respond.io are far more established). Every
   comparison post must include the genuine concessions. A comparison that finds
   no competitor better at anything reads as marketing and converts worse.

3. **Never claim a Flas feature that is not in the list above.** In particular,
   Flas does **not** currently support Gemini as a bring-your-own AI key (OpenAI
   and Claude only), and does **not** attach images to social posts. Do not
   mention either.

4. **Do not quote WhatsApp per-message prices.** Meta changes them and they vary
   by country. Explain the structure — marketing costs more than utility, prices
   vary by recipient country — and point readers to Meta's current rate card.

5. **Write like a practitioner, not a marketer.** The existing posts say things
   like "most small businesses do not need the API" and "if none of these
   describe you, stay on the free app." Keep that. Admit when a competitor is
   better at something and when the reader should not buy. Concrete beats
   enthusiastic.

6. **No filler.** Ban these openings: "In today's fast-paced digital world", "In
   the ever-evolving landscape", "Are you struggling with". Start with the
   reader's actual problem in the first sentence. No conclusion that restates
   the article — end on the practical takeaway.

7. **1,200–1,800 words each.** Every post must contain at least one of: a
   comparison table, a numbered procedure, or a worked example with real
   numbers. An article that is only prose is not finished.

8. **No two posts may share a slug or substantially overlap.** Before writing,
   check the list below and the nine posts already in the file.

9. **Original wording throughout.** Do not paraphrase competitor marketing copy
   or documentation. Explain mechanisms in your own words.

## Already published — do not duplicate these

`whatsapp-business-app-vs-api`, `whatsapp-business-api-approval-checklist`,
`whatsapp-message-templates-that-get-approved`, `whatsapp-opt-in-that-protects-you`,
`turn-website-visitors-into-whatsapp-leads`, `whatsapp-shared-inbox-for-teams`,
`whatsapp-chatbot-that-customers-dont-hate`, `quotation-to-payment-on-whatsapp`,
`whatsapp-crm-for-uae-businesses`

## The 50 topics

### Batch 1 — Comparison and alternatives (highest commercial intent)

Every one of these needs the `[VERIFY: …]` placeholders from rule 2. Category:
`Comparison`.

1. `wati-alternatives-for-small-business` — Wati alternatives: what to compare beyond price
2. `respond-io-alternative` — Looking for a Respond.io alternative? Read this first
3. `interakt-vs-aisensy-vs-flas` — Interakt, AiSensy and Flas compared
4. `best-whatsapp-crm-uae` — The best WhatsApp CRM for UAE businesses
5. `cheapest-whatsapp-crm-what-you-give-up` — The cheapest WhatsApp CRM, and what you give up
6. `chatwoot-vs-hosted-whatsapp-crm` — Chatwoot vs a hosted CRM: when self-hosting stops being cheaper
7. `whatsapp-crm-vs-general-crm` — Why a general CRM with a WhatsApp plugin usually disappoints
8. `zoko-alternative-for-non-shopify` — A Zoko alternative when you are not only on Shopify
9. `twilio-vs-cloud-api-direct` — Twilio vs going direct on the Cloud API
10. `switching-whatsapp-crm-without-losing-history` — Switching WhatsApp CRM without losing your chat history

### Batch 2 — WhatsApp Business Platform, practical

11. `whatsapp-broadcast-limits-explained` — Broadcast limits and what actually raises them
12. `whatsapp-quality-rating-recovery` — Your quality rating went red: how to recover it
13. `whatsapp-number-banned-what-now` — Your WhatsApp number got restricted. What now?
14. `whatsapp-green-tick-truth` — The green tick: what it is, what it is not, and who gets it
15. `migrate-number-from-business-app-to-api` — Migrating your number without losing customers
16. `whatsapp-24-hour-window-explained` — The 24-hour window, explained properly
17. `whatsapp-utility-vs-marketing-templates` — Utility or marketing? The categorisation that decides your bill
18. `whatsapp-flows-and-interactive-messages` — Buttons, lists and flows: when each one helps
19. `two-whatsapp-numbers-one-business` — Running two numbers without confusing customers
20. `whatsapp-api-without-a-developer` — Getting on the API without hiring a developer

### Batch 3 — Industry use cases (long tail, low competition, high conversion)

21. `whatsapp-crm-for-real-estate` — Real estate: managing viewings and leads on WhatsApp
22. `whatsapp-crm-for-clinics` — Clinics and dental: appointments, reminders, no-shows
23. `whatsapp-crm-for-restaurants` — Restaurants: orders, reservations and delivery on WhatsApp
24. `whatsapp-crm-for-car-rental` — Car rental and limousine: bookings that do not get lost
25. `whatsapp-crm-for-security-companies` — Security and CCTV installers: quote to install
26. `whatsapp-crm-for-travel-agencies` — Travel agencies: itineraries and deposits over chat
27. `whatsapp-crm-for-education` — Schools and training centres: admissions on WhatsApp
28. `whatsapp-crm-for-ecommerce` — E-commerce: abandoned carts and order updates
29. `whatsapp-crm-for-logistics` — Delivery and logistics: driver-to-customer messaging
30. `whatsapp-crm-for-beauty-salons` — Salons and spas: bookings, reminders, rebooking

### Batch 4 — Operations and growth

31. `whatsapp-response-time-benchmark` — What a good WhatsApp response time actually is
32. `whatsapp-team-training-guide` — Training a team to use a shared inbox well
33. `whatsapp-abandoned-cart-recovery` — Abandoned cart recovery that does not get you blocked
34. `whatsapp-customer-feedback` — Collecting reviews and feedback over WhatsApp
35. `whatsapp-appointment-reminders` — Appointment reminders that actually reduce no-shows
36. `whatsapp-payment-reminders` — Chasing payment on WhatsApp without damaging the relationship
37. `whatsapp-vs-email-marketing` — WhatsApp or email? Where each one still wins
38. `whatsapp-lead-qualification` — Qualifying a lead inside a chat, in four questions
39. `whatsapp-analytics-that-matter` — The five WhatsApp metrics worth a dashboard
40. `scaling-from-one-agent-to-ten` — Scaling from one agent to ten without chaos

### Batch 5 — Compliance, region and AI

41. `uae-pdpl-whatsapp-marketing` — UAE data protection and WhatsApp marketing
42. `saudi-pdpl-for-whatsapp-business` — Saudi PDPL: what it means for WhatsApp messaging
43. `gdpr-whatsapp-business` — GDPR and WhatsApp Business for businesses serving the EU
44. `vat-invoice-requirements-uae` — What a compliant UAE tax invoice must contain
45. `arabic-english-whatsapp-templates` — Running Arabic and English templates properly
46. `ramadan-business-messaging` — Messaging customers during Ramadan
47. `ai-chatbot-hallucination-risk` — Stopping an AI chatbot from inventing your prices
48. `train-ai-on-your-business-data` — Training an AI assistant on your own catalogue
49. `ai-vs-rule-based-chatbot` — AI or rule-based? Pick per use case, not per vendor
50. `whatsapp-automation-that-annoys-customers` — Nine WhatsApp automations customers hate

## Output format

For each batch, return **only** the TypeScript objects, ready to paste into the
`POSTS` array in `src/content/blog.ts`. No surrounding prose, no markdown fences
around the whole response, no explanation. Start at `  {` and end at `  },`.

After each batch, list any `[VERIFY: …]` placeholders you left, so they can be
checked before publishing.

---

## After Gemini returns a batch

1. Paste the objects into the `POSTS` array in `src/content/blog.ts`.
2. Resolve every `[VERIFY: …]` against the competitor's live pricing page. Delete
   the claim if you cannot confirm it — an unverified claim is worse than a gap.
3. Run `npx tsc --noEmit` then `npx vite build`. An unescaped backtick in `html`
   breaks the build, and this is where it surfaces.
4. Spot-read two articles end to end. If they sound the same, the batch is too
   repetitive and needs regenerating with sharper topic angles.
5. `/sitemap.xml` picks the posts up automatically. Nothing else to wire.
