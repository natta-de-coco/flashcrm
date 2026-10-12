/**
 * The Flas CRM marketing blog.
 *
 * Posts live in the repository rather than in the database on purpose. This is
 * Flas's own marketing content, not tenant content: it must render server-side
 * for crawlers, survive with no session and no RLS in play, and never depend on
 * a query that could fail. `seo_articles` remains what it has always been --
 * tenant-scoped articles published to a customer's own WordPress site.
 *
 * Adding a post: append to POSTS, keep `slug` stable forever (it is the URL),
 * and set `updated` when you materially revise the text. /sitemap.xml and the
 * blog index both read from this array, so nothing else needs touching.
 *
 * On accuracy: WhatsApp's rate card and limit tiers change, so the writing here
 * deliberately explains structure and points at Meta's own pages for current
 * numbers. Publishing a figure that goes stale is worse than not publishing it.
 */

import { AI_POSTS } from "./blog-posts/ai-workflows";
import { SALES_POSTS } from "./blog-posts/sales-operations";
import { BUYING_POSTS } from "./blog-posts/buying-guides";
import { COMPARISON_POSTS } from "./blog-posts/comparisons";
import { LEAD_CAPTURE_POSTS } from "./blog-posts/lead-capture";

export type Post = {
  slug: string;
  title: string;
  /** Used for <meta name="description"> and the card, so keep it under ~160 chars. */
  excerpt: string;
  category: string;
  published: string;
  updated?: string;
  readingMinutes: number;
  keywords: string[];
  /** Body HTML. Headings start at h2 -- the page owns the single h1. */
  html: string;
};

/** Hand-written guides. Generated batches are merged into POSTS below. */
const CORE_POSTS: Post[] = [
  {
    slug: "whatsapp-business-app-vs-api",
    title: "WhatsApp Business App vs the Cloud API: which one does your business need?",
    excerpt:
      "The free app and the Cloud API look similar and behave nothing alike. Here is the honest comparison, including when staying on the free app is the right call.",
    category: "WhatsApp",
    published: "2026-09-07",
    readingMinutes: 7,
    keywords: [
      "whatsapp business api",
      "whatsapp business app vs api",
      "whatsapp cloud api",
      "whatsapp crm",
    ],
    html: `
<p>Almost every business that outgrows WhatsApp asks the same question, and almost every answer online is written by someone selling the more expensive option. So let us start with the part vendors tend to skip: <strong>most small businesses do not need the API</strong>, and moving to it too early makes daily work harder, not easier.</p>

<p>Here is how to tell which side of the line you are on.</p>

<h2>What each one actually is</h2>

<p>The <strong>WhatsApp Business App</strong> is a free phone app. It is a WhatsApp account with a catalogue, quick replies, labels and away messages bolted on. It runs on one phone, and you can link a handful of additional devices to the same account.</p>

<p>The <strong>WhatsApp Business Platform</strong> — what people mean by "the API" — is not an app at all. There is no interface. It is a programming interface that Meta hosts, and it does nothing on its own. You point it at a system that can send and receive messages, and that system becomes your inbox. Without software on the other end, the API is an unusable phone number.</p>

<p>This is the single most common misunderstanding. Businesses apply for API access expecting a better app and receive a set of credentials instead.</p>

<h2>The decision, in one table</h2>

<table>
  <thead>
    <tr><th>Question</th><th>Business App</th><th>Cloud API</th></tr>
  </thead>
  <tbody>
    <tr><td>How many people can reply at once?</td><td>Realistically one, awkwardly a few</td><td>Your whole team, in parallel</td></tr>
    <tr><td>Can two agents avoid answering the same chat?</td><td>No</td><td>Yes — assignment and status</td></tr>
    <tr><td>Automated replies</td><td>Away message and greeting only</td><td>Anything you can program</td></tr>
    <tr><td>Does chat history survive a lost phone?</td><td>Only via backup</td><td>Yes, it lives in your system</td></tr>
    <tr><td>Cost</td><td>Free</td><td>Per-message fees, plus software</td></tr>
    <tr><td>Setup effort</td><td>Ten minutes</td><td>Days, including Meta review</td></tr>
    <tr><td>Send to a list of customers</td><td>Broadcast lists, capped and manual</td><td>Yes, with approved templates</td></tr>
  </tbody>
</table>

<h2>Four signs you have outgrown the free app</h2>

<ol>
  <li><strong>Two people are fighting over one phone.</strong> This is the clearest signal. The moment replying is a rota rather than a job, the app is the bottleneck.</li>
  <li><strong>You are losing chats.</strong> Nobody can tell which conversations were answered, so some are answered twice and some never.</li>
  <li><strong>The phone is a single point of failure.</strong> If the person holding it is on leave, your customer service stops.</li>
  <li><strong>You want to message customers first.</strong> Broadcast lists only reach people who have saved your number, which in practice is a small fraction of your customers.</li>
</ol>

<p>If none of these describe you, stay on the free app. Genuinely. You will spend money and weeks of approval time to solve a problem you do not have.</p>

<h2>What moving to the API actually involves</h2>

<p>Expect four things, roughly in this order:</p>

<ul>
  <li><strong>A Meta Business account</strong>, with your business verified. This wants real documents — trade licence, proof of address, a matching website.</li>
  <li><strong>A phone number that is not currently on WhatsApp.</strong> This trips people constantly: a number already registered on the Business App must be deleted from it first, and that deletes its chat history. Many businesses move to the API on a new number for exactly this reason.</li>
  <li><strong>A display name that survives review.</strong> Meta checks it matches your actual business.</li>
  <li><strong>Software to connect it to.</strong> The API is plumbing; the inbox is a separate decision.</li>
</ul>

<h2>The rule that surprises everyone: the 24-hour window</h2>

<p>Once you are on the API, you cannot simply message whoever you like. When a customer messages you, a <strong>24-hour customer service window</strong> opens, and inside it you may reply freely, in your own words, as many times as the conversation needs.</p>

<p>Outside that window, free-form messages will not deliver. You may only send a <strong>template</strong> — a message whose wording Meta approved in advance. Templates fall into Marketing, Utility and Authentication categories, and they are priced differently, with marketing the most expensive.</p>

<p>The practical consequence is that your first reply matters twice over. Answer within the day and the conversation costs you nothing extra. Answer three days later and you are paying for a template just to restart it.</p>

<h2>What it costs</h2>

<p>Meta charges per message for templates, at rates that vary considerably by country — a marketing template to a customer in India and one in the UAE are not close in price. Meta has also revised this pricing model more than once. Rather than quote a figure that will be wrong by the time you read this, check <a href="https://business.whatsapp.com/products/platform-pricing" rel="nofollow noreferrer" target="_blank">Meta's current rate card</a> for the countries you actually message.</p>

<p>Budget for two line items, not one: what Meta charges for messages, and what your inbox software charges. They are unrelated.</p>

<h2>Choosing the software, not just the API</h2>

<p>Since the API does nothing alone, the software is the decision that determines your daily experience. Worth asking:</p>

<ul>
  <li>Can several numbers live in one workspace, with replies going out from whichever number the customer wrote to?</li>
  <li>When someone leaves, can you cut their access without changing a shared password?</li>
  <li>Does the chat history belong to you, exportable, or is it hostage to the subscription?</li>
  <li>Does it handle template submission, or leave you in Meta's interface?</li>
</ul>

<p>That last one matters more than it sounds. Template rejection is the most common reason a WhatsApp rollout stalls.</p>

<h2>In short</h2>

<p>Stay on the free app while one person can comfortably answer everything. Move to the Cloud API when the constraint is your team rather than your phone — and when you move, choose the inbox before you chase the credentials.</p>
`,
  },

  {
    slug: "whatsapp-business-api-approval-checklist",
    title:
      "Getting your WhatsApp Business API number approved: the checklist Meta does not publish",
    excerpt:
      "Business verification, display name review and number registration reject applications for boring, avoidable reasons. Here is what to fix before you apply.",
    category: "WhatsApp",
    published: "2026-09-07",
    readingMinutes: 8,
    keywords: [
      "whatsapp business verification",
      "meta business verification",
      "whatsapp display name approval",
      "whatsapp api setup",
    ],
    html: `
<p>Applications for WhatsApp Business Platform access rarely fail on the merits. They fail because a trade licence lists a slightly different company name than the Meta Business account, or because the website has no phone number on it, or because someone tried to register a number that already had WhatsApp on it.</p>

<p>All of that is fixable in advance. Work through this before you apply and you avoid the review cycle that costs most businesses two or three weeks.</p>

<h2>Step 1 — Make your business verifiable before you ask to be verified</h2>

<p>Meta's business verification is a documents check. A reviewer confirms that your business exists, is legally registered, and that you are connected to it. They check three things against each other: your legal documents, your Meta Business account details, and your public web presence.</p>

<p>The failures are almost always mismatches:</p>

<ul>
  <li><strong>The legal name is not the trading name.</strong> Your licence says "Al Noor General Trading LLC" and you entered "Al Noor Electronics". Enter the legal name exactly as printed, and use the trading name as the display name later.</li>
  <li><strong>The address does not match.</strong> Including the small things — "Office 402" against "Suite 402" has been enough.</li>
  <li><strong>The website does not corroborate anything.</strong> A reviewer should be able to land on your site and find your business name, a phone number and an address without hunting. A landing page with a contact form does not do this.</li>
  <li><strong>The email is a Gmail address.</strong> An address at your own domain is treated as far stronger evidence. If you have a domain, use it.</li>
</ul>

<p>Prepare a certificate of incorporation or trade licence, plus something showing the address — a utility bill or bank statement in the business name. Scans should be complete pages, in colour, unedited, corners visible. Cropped screenshots get rejected.</p>

<h2>Step 2 — Pick a number that can actually be registered</h2>

<p>The number you want must not be active on WhatsApp — neither the consumer app nor the Business App. If it is, you must delete the account from within that app first, and <strong>deleting it deletes its chat history</strong>.</p>

<p>This catches businesses badly. The number customers already know is usually the number already running the Business App, with years of conversations in it. You have three options:</p>

<ol>
  <li><strong>Move the known number and accept the history loss.</strong> Export what you can first. Continuity for customers is usually worth more than an archive nobody reads.</li>
  <li><strong>Start the API on a new number</strong> and redirect gradually. Cleaner technically, but you are rebuilding recognition.</li>
  <li><strong>Run both</strong> — the old number for existing customers, the new one on the website and ads.</li>
</ol>

<p>The number also needs to receive an SMS or voice call for the one-time code, and must not be a shortcode. Landlines are acceptable if they can take the voice call.</p>

<h2>Step 3 — Choose a display name that will pass</h2>

<p>Your display name is what customers see. Meta reviews it, and the rule is that it must relate clearly to your business.</p>

<p>What passes: your business name, or your business name plus a plain function — "Al Noor Electronics" or "Al Noor Electronics Support".</p>

<p>What gets rejected:</p>

<ul>
  <li>Generic words alone — "Customer Service", "Sales", "Support"</li>
  <li>A phone number, URL or emoji as the name</li>
  <li>Promotional language — "Best Deals Dubai"</li>
  <li>A name with no visible link to the verified business</li>
</ul>

<p>If your trading name genuinely differs from your legal name, make sure the trading name appears prominently on your website. That is the evidence a reviewer looks for.</p>

<h2>Step 4 — Understand what you get on day one</h2>

<p>New numbers start with a limited messaging tier — you can only start conversations with a capped number of unique customers per day. The cap rises automatically as you send quality messages without accumulating blocks.</p>

<p>Two things move the tier:</p>

<ul>
  <li><strong>Quality rating</strong>, driven mainly by whether people block or report you. Meta shows it as green, yellow or red.</li>
  <li><strong>Consistent sending</strong> within your current cap.</li>
</ul>

<p>So the first fortnight matters. Businesses that import a purchased list and message everyone immediately collect blocks fast, drop to a red rating, and get their tier reduced or their number restricted. Send to people who asked to hear from you, and the tier climbs on its own.</p>

<h2>Step 5 — Green tick: what it is and is not</h2>

<p>The green checkmark is an <strong>Official Business Account</strong>, and it is not the same as business verification. Verification is a prerequisite; the tick is granted separately, based largely on whether your brand is notable — press coverage and public presence, not payment.</p>

<p>You cannot buy it, and anyone offering to sell you one is selling you nothing. Most businesses run for years without it and lose no customers.</p>

<h2>Step 6 — Write your first templates before you need them</h2>

<p>You will need approved templates to start conversations outside the 24-hour window, and approval takes time. Have your first few submitted early.</p>

<p>Templates are rejected for predictable reasons: variables at the very start or end of the message, placeholder text left in the example, category chosen wrongly (a promotion submitted as Utility), or wording that reads as unsolicited marketing without a clear opt-out.</p>

<p>Write the example content as if it were a real message to a real customer. Reviewers read the example, not your intentions.</p>

<h2>The short version</h2>

<p>Get your documents consistent, put real contact details on your website, free up the number you intend to use, choose a display name that names your business, and go gently for the first two weeks. Nearly every rejection comes from one of those five.</p>
`,
  },

  {
    slug: "whatsapp-message-templates-that-get-approved",
    title: "Why WhatsApp rejects your message templates — and how to write ones that pass",
    excerpt:
      "Template rejection is the most common reason a WhatsApp rollout stalls. The rules are consistent once you see them, and most rejections come from five mistakes.",
    category: "WhatsApp",
    published: "2026-09-07",
    readingMinutes: 6,
    keywords: [
      "whatsapp message templates",
      "whatsapp template rejected",
      "whatsapp template approval",
      "whatsapp utility vs marketing template",
    ],
    html: `
<p>A template is a message whose wording Meta approved in advance. You need one to start a conversation outside the 24-hour window — which means until your templates are approved, you cannot reach customers first at all.</p>

<p>Rejections are rarely mysterious. Five mistakes account for most of them.</p>

<h2>Mistake 1 — Choosing the wrong category</h2>

<p>Every template is Marketing, Utility or Authentication, and the category is not a label you pick for convenience. It changes what you are allowed to say and what you are charged.</p>

<ul>
  <li><strong>Utility</strong> follows up on something the customer did: an order confirmation, a delivery update, an appointment reminder, an invoice.</li>
  <li><strong>Marketing</strong> is anything promotional — offers, launches, re-engagement, newsletters. Also anything that mixes a transactional update <em>with</em> a promotion.</li>
  <li><strong>Authentication</strong> is one-time passcodes, nothing else.</li>
</ul>

<p>The costly error is submitting marketing as utility, usually to save money. Meta re-categorises it, and repeated attempts damage your standing. The subtle version catches honest businesses too: <em>"Your order has shipped. Use SAVE10 for 10% off your next order!"</em> is a marketing template, because of the second sentence.</p>

<h2>Mistake 2 — Placeholder problems</h2>

<p>Variables are written <code>{{1}}</code>, <code>{{2}}</code>, and there are firm rules:</p>

<ul>
  <li>A template <strong>cannot begin or end with a variable.</strong> "{{1}}, your order is ready" is rejected. "Hello {{1}}, your order is ready" is fine.</li>
  <li>Variables must be numbered in order with no gaps.</li>
  <li>Two variables cannot sit adjacent — "{{1}} {{2}}" needs words between them.</li>
  <li>You must supply a realistic <strong>sample value</strong> for each. Leaving the sample blank, or writing "name", is an instant rejection. Write "Fatima".</li>
</ul>

<h2>Mistake 3 — Writing for the reviewer instead of the customer</h2>

<p>Reviewers judge the message as a customer would receive it. Vague templates fail because their purpose is not clear.</p>

<p><strong>Rejected:</strong> <em>"Hello {{1}}, we have an update for you. Click here: {{2}}"</em> — this could be anything, and reads like phishing.</p>

<p><strong>Approved:</strong> <em>"Hello {{1}}, your order {{2}} has been dispatched and should arrive by {{3}}. Track it here: {{4}}"</em> — the purpose is unmistakable.</p>

<p>Specificity helps you twice: it passes review, and customers respond to it.</p>

<h2>Mistake 4 — Marketing with no way out</h2>

<p>Marketing templates should make opting out easy. Meta looks for it, and its absence drives the blocks that damage your quality rating.</p>

<p>Add a quick-reply button reading "Stop promotions", and honour it in your system. This is not optional in spirit — a customer who cannot leave will block you instead, and blocks are the single biggest threat to your number.</p>

<h2>Mistake 5 — Formatting and length</h2>

<ul>
  <li>Body text is capped (currently 1024 characters) — a template is not an email.</li>
  <li>No excessive capitals. "LIMITED TIME OFFER!!!" reads as spam to a reviewer as much as to a person.</li>
  <li>URLs must be real and reachable. Shorteners that mask the destination are viewed poorly.</li>
  <li>Emoji are allowed, in moderation. Three per message is plenty.</li>
</ul>

<h2>A template that works</h2>

<pre><code>Category: Utility
Name: order_ready_for_pickup

Hello {{1}}, your order {{2}} is ready for collection at our
{{3}} branch. We are open until {{4}} today.

Sample: Fatima | #A-2291 | Deira | 9pm
Buttons: [Call us] [Get directions]</code></pre>

<p>Clear purpose, variables away from the edges, realistic samples, useful buttons, no promotion smuggled in.</p>

<h2>If you are rejected</h2>

<p>You can edit and resubmit. Read the stated reason, change the actual problem rather than reshuffling words, and resubmit once. Submitting the same template repeatedly without meaningful changes counts against your account.</p>

<p>If a template is re-categorised rather than rejected, it still works — you are simply paying marketing rates. Rewriting to remove the promotional sentence usually restores utility pricing.</p>

<h2>Build a small library early</h2>

<p>Most businesses need fewer than ten: order confirmation, dispatch, delivery, appointment reminder, quotation ready, payment reminder, feedback request, and one or two promotional. Get them approved before you need them, because approval is not instant and the day you urgently want to message customers is the wrong day to discover it.</p>
`,
  },

  {
    slug: "whatsapp-opt-in-that-protects-you",
    title: "WhatsApp opt-in: collecting consent that protects your number",
    excerpt:
      "Blocks are the fastest way to lose a WhatsApp number. Consent is not paperwork — it is the mechanism that keeps your messages delivering.",
    category: "Compliance",
    published: "2026-09-07",
    readingMinutes: 6,
    keywords: [
      "whatsapp opt-in",
      "whatsapp marketing consent",
      "whatsapp quality rating",
      "whatsapp blocked number",
    ],
    html: `
<p>Businesses treat consent as a legal box to tick. On WhatsApp it is closer to an operational control: it is what stands between you and the block rate that gets your number restricted.</p>

<h2>Why blocks matter more than anything else</h2>

<p>Meta scores your number with a quality rating driven largely by how recipients react. Blocks and "report spam" taps push it down. A low rating reduces how many people you may message per day, and sustained problems can restrict the number entirely.</p>

<p>The chain is short and unforgiving: message people who did not ask → they block you → your rating falls → your limit drops → the number you built your customer service on stops working.</p>

<p>Consent is how you break that chain at the first link.</p>

<h2>What counts as opt-in</h2>

<p>Meta requires that people have agreed to hear from you on WhatsApp specifically, and that you can demonstrate it. Three practical requirements:</p>

<ul>
  <li><strong>It names WhatsApp.</strong> Agreeing to "receive updates" is not agreeing to WhatsApp messages. Say the channel.</li>
  <li><strong>It names you.</strong> The customer should know which business will be messaging them.</li>
  <li><strong>It is recorded.</strong> When, where, and what wording they agreed to.</li>
</ul>

<p>A pre-ticked box is not consent. A phone number entered to complete a purchase is not consent to marketing. A list bought from anyone is not consent, and is the fastest route to a restricted number.</p>

<h2>Where opt-in actually comes from</h2>

<p>In practice, four sources cover most businesses:</p>

<ol>
  <li><strong>The customer messages you first.</strong> The strongest form there is — they initiated it, and it opens the 24-hour window.</li>
  <li><strong>A website chat widget</strong> that asks for a WhatsApp number with a clear line about what you will send.</li>
  <li><strong>Checkout,</strong> with an unticked box: "Send my order updates on WhatsApp."</li>
  <li><strong>In person,</strong> a QR code that opens a chat. Scanning and sending is unambiguous.</li>
</ol>

<p>Note the separation worth keeping: consent to <em>order updates</em> is not consent to <em>promotions</em>. Record them as two permissions. It costs a checkbox and saves your rating.</p>

<h2>Wording that works</h2>

<p>Weak: <em>"Sign up for updates."</em></p>

<p>Strong: <em>"Send me order updates and offers from Al Noor Electronics on WhatsApp. You can reply STOP at any time."</em></p>

<p>It names the channel, names the business, says what will arrive, and shows the way out. That last clause reduces blocks measurably, because a customer who knows they can leave easily reaches for STOP rather than Block.</p>

<h2>Honour the exit immediately</h2>

<p>When someone opts out, stop — that day, not at the end of a campaign. If your system cannot suppress a contact instantly, that is a defect worth fixing before your next send.</p>

<p>Keep the record of the opt-out too. Being able to show when someone left is as valuable as showing when they joined.</p>

<h2>Data protection sits on top</h2>

<p>Meta's rules are the operational layer. The legal layer depends on where your customers are — the UAE, Saudi Arabia, the EU and India all have their own regimes, and several require a lawful basis for processing, a retention period, and a route for someone to request deletion.</p>

<p>The overlap is convenient: the record that satisfies Meta — who consented, when, to what, and when they left — is broadly the record a regulator expects. Keep it once, properly.</p>

<h2>A workable standard</h2>

<ul>
  <li>Never message someone who has not asked, on any channel.</li>
  <li>Store the timestamp, the source and the exact wording shown.</li>
  <li>Track marketing consent separately from service messages.</li>
  <li>Put an opt-out in every marketing template and honour it same-day.</li>
  <li>Watch your quality rating weekly; treat a drop as a message-quality problem, not a bad-luck problem.</li>
</ul>

<p>None of this is expensive. It is considerably cheaper than losing the number your customers already have saved.</p>
`,
  },

  {
    slug: "turn-website-visitors-into-whatsapp-leads",
    title: "Turning website visitors into WhatsApp conversations (without annoying them)",
    excerpt:
      "Most site visitors leave without contacting you. A chat entry point captures more of them than a contact form — if you ask for the right thing at the right moment.",
    category: "Lead capture",
    published: "2026-09-07",
    readingMinutes: 6,
    keywords: [
      "whatsapp lead capture",
      "website chat widget",
      "whatsapp button website",
      "convert website visitors whatsapp",
    ],
    html: `
<p>A contact form asks someone to write a message into a box and trust that a stranger will reply. A WhatsApp entry point asks them to start a chat in an app they already have open. The second converts better, and for a simple reason: it costs the visitor less.</p>

<p>But the details decide whether it helps or irritates. Here is what tends to work.</p>

<h2>A link is not a lead</h2>

<p>The most common setup is a floating WhatsApp button linking to <code>wa.me/your-number</code>. It works, and it throws away most of the value.</p>

<p>When someone taps it, they leave your site and arrive in WhatsApp with an empty message box. You learn nothing about them unless they type something, and you have no idea which page they came from. Many people tap, see the blank chat, and close it.</p>

<p>Ask for the number on your own site instead — name and WhatsApp number before the chat opens — and you have a contact record even if they never send a word. That is the difference between a link and a lead.</p>

<h2>Ask for two fields, not five</h2>

<p>Every field costs completions. For a first contact you need a name and a WhatsApp number. Email is worth adding only if you genuinely follow up by email.</p>

<p>Everything else — company size, budget, how they heard about you — belongs in the conversation, where it is a question rather than an obstacle.</p>

<h2>Timing beats persistence</h2>

<p>A popup that fires the instant a page loads interrupts someone who has not yet decided whether they care. It is the most common reason chat widgets get dismissed reflexively.</p>

<p>Better triggers:</p>

<ul>
  <li><strong>After genuine engagement</strong> — perhaps twenty seconds, or halfway down the page.</li>
  <li><strong>On exit intent</strong> on desktop, when the cursor leaves toward the tab bar.</li>
  <li><strong>On high-intent pages</strong> — pricing, a product, contact — sooner than on a blog post.</li>
</ul>

<p>And once dismissed, stay dismissed for that session. A widget that reappears is worse than no widget.</p>

<h2>Say what happens next</h2>

<p>"Chat with us" is weaker than "Get a price on WhatsApp — we usually reply within an hour."</p>

<p>The second sets an expectation and names the value. If you promise an hour, meet it: an unanswered chat is worse than no chat, because the customer has now been ignored personally rather than merely not engaged.</p>

<h2>Capture the context automatically</h2>

<p>Your system should record which page the visitor was on, what brought them there, and when — without asking. Arriving at a conversation already knowing someone was looking at a specific product turns a cold opener into a useful one.</p>

<h2>Route it to the right number</h2>

<p>If you run more than one number — sales and support, or separate branches — the enquiry should reach the right one automatically, based on the page or a form field. Sending everything to one inbox for manual forwarding adds a delay at precisely the moment speed matters.</p>

<h2>Answer fast, then follow up once</h2>

<p>Speed is the whole game. A reply within minutes lands while the visitor is still thinking about you; a reply the next day arrives after they have contacted someone else.</p>

<p>Remember the 24-hour window: while it is open you can write freely. After it closes you need an approved template, which costs money and reads more formally. So if a conversation goes quiet, one useful follow-up inside the day is worth more than three the following week.</p>

<h2>Measure the right number</h2>

<p>Widget impressions do not matter. Track:</p>

<ul>
  <li>Contact details captured per hundred visitors</li>
  <li>How many of those became a real conversation</li>
  <li>Median time to first reply</li>
  <li>How many converted</li>
</ul>

<p>If capture is healthy but conversations are not, your reply time is the problem. If capture itself is low, revisit the trigger and the wording before anything else.</p>

<h2>The short version</h2>

<p>Collect the number on your own site, ask for two fields, trigger on engagement rather than arrival, promise a response time you can keep, and route it to whoever can actually answer. The technology is the easy part — the discipline of replying quickly is what turns it into revenue.</p>
`,
  },

  {
    slug: "whatsapp-shared-inbox-for-teams",
    title: "One number, five agents: how a shared WhatsApp inbox actually works",
    excerpt:
      "Passing a phone between staff does not scale. Here is what changes when a team answers one number properly, and the three habits that decide whether it works.",
    category: "Operations",
    published: "2026-09-08",
    readingMinutes: 6,
    keywords: [
      "whatsapp shared inbox",
      "whatsapp team inbox",
      "multiple agents one whatsapp number",
      "whatsapp for customer service teams",
    ],
    html: `
<p>The moment a second person needs to answer WhatsApp, most businesses invent the same workaround: one phone on a desk, or the WhatsApp Business app linked to a few devices, and a rule that whoever sees it first replies.</p>

<p>It holds until it does not. Two people answer the same customer with different prices. A chat gets read, silently, by someone who then gets distracted. Someone leaves and takes the login with them.</p>

<h2>What a shared inbox changes</h2>

<p>A shared inbox connects your number through the Cloud API to software that several people sign into. Each agent has their own account, and the conversation is a record rather than a notification.</p>

<p>Four things become possible that were not before:</p>

<ul>
  <li><strong>Assignment.</strong> A chat belongs to someone. If it belongs to nobody, that is visible rather than assumed.</li>
  <li><strong>Status.</strong> Open, pending, closed. "Did anyone deal with this?" becomes a filter instead of a question shouted across the office.</li>
  <li><strong>Individual accounts.</strong> When someone leaves you revoke their access, not change a shared password everyone has to relearn.</li>
  <li><strong>History that outlives the phone.</strong> Conversations live in your system. A lost or wiped handset costs you a handset.</li>
</ul>

<h2>The three habits that decide whether it works</h2>

<p>The software is the easy half. Teams that get value from a shared inbox tend to share three habits.</p>

<h3>1. Every chat has an owner within minutes</h3>

<p>Unassigned chats are where conversations die. Whether you assign round-robin, by expertise, or by whoever claims it first matters far less than that the queue is never ambiguous. If a chat can sit for an hour with nobody responsible, it will.</p>

<h3>2. Closing means closing</h3>

<p>An inbox where everything stays open forever is a list, not a workflow. Agree what "closed" means — question answered, order placed, customer said thanks — and close things. The count of open chats should be a number someone can look at and act on.</p>

<h3>3. Internal notes instead of side conversations</h3>

<p>If the answer to "what did we quote this customer?" lives in someone's private chat with a colleague, the next agent starts from nothing. Notes on the conversation keep context with the customer rather than with the person who happened to handle it last.</p>

<h2>What to measure</h2>

<p>Two numbers tell you nearly everything:</p>

<ul>
  <li><strong>Median time to first reply.</strong> Not average — one chat answered three days later ruins an average and hides the typical experience.</li>
  <li><strong>Chats with no owner right now.</strong> If this is ever more than a handful, the assignment habit has slipped.</li>
</ul>

<p>Resolution time is worth watching later. Early on, first-reply time is the number that moves revenue, because it is the one the customer feels.</p>

<h2>Multiple numbers, one inbox</h2>

<p>Once a team is comfortable, separating numbers by function — sales and support, or one per branch — usually helps more than it complicates, provided replies go out from whichever number the customer wrote to. A customer who messaged the Deira branch should not receive a reply from head office; it reads as a different business.</p>

<h2>When you do not need this</h2>

<p>If one person answers everything comfortably and nothing is being missed, the free WhatsApp Business app is doing its job. A shared inbox solves a coordination problem. Buying one before you have that problem adds cost and a migration for no gain — see our <a href="/blog/whatsapp-business-app-vs-api">comparison of the app and the API</a> for where the line sits.</p>
`,
  },

  {
    slug: "whatsapp-chatbot-that-customers-dont-hate",
    title: "Building a WhatsApp chatbot customers do not hate",
    excerpt:
      "Most business chatbots are a maze between the customer and a human. A useful one answers the three questions people actually ask, then gets out of the way.",
    category: "AI",
    published: "2026-09-08",
    readingMinutes: 6,
    keywords: [
      "whatsapp chatbot",
      "whatsapp ai chatbot",
      "whatsapp automated replies",
      "chatbot human handoff",
    ],
    html: `
<p>Ask anyone about business chatbots and you will hear the same complaint: it would not let them reach a person. That is the bar. Not intelligence — escape.</p>

<p>A chatbot on WhatsApp has one advantage over the web widgets that earned that reputation: the customer is in a normal conversation, and if the bot is unhelpful they will simply type "human" and expect it to work. Build for that and the rest gets easier.</p>

<h2>Answer the three questions, not thirty</h2>

<p>Look at a month of your own conversations and the distribution is always lopsided. For most businesses, a handful of questions cover the majority of first messages:</p>

<ul>
  <li>Do you have <em>X</em>, and how much is it?</li>
  <li>Where are you, and when are you open?</li>
  <li>How long does delivery or installation take?</li>
</ul>

<p>A bot that answers those three accurately, instantly, at eleven at night, is genuinely valuable. A bot that attempts to handle every scenario will be wrong often enough that customers stop trusting any of it.</p>

<p>Start narrow. Widen only where the transcripts show demand.</p>

<h2>Ground it in your own information</h2>

<p>A model answering from general knowledge will invent your delivery policy. Confidently. The fix is to give it your actual material — product list, prices, hours, locations, warranty terms — and instruct it to say it does not know rather than fill gaps.</p>

<p>"I'm not sure about that, let me get someone" is a good answer. An invented price is a complaint, and possibly a refund.</p>

<h2>Make the handoff obvious and instant</h2>

<p>Three rules that matter more than anything else the bot does:</p>

<ol>
  <li><strong>Any request for a person works immediately.</strong> "Human", "agent", "speak to someone", or plain frustration. No confirmation step.</li>
  <li><strong>The bot says it is a bot.</strong> Customers are far more tolerant of a machine that admits it than one pretending. It also stops them reading terseness as rudeness.</li>
  <li><strong>Repetition triggers escalation.</strong> If someone asks the same thing twice, the bot has failed. Hand over rather than rephrase.</li>
</ol>

<h2>Know when to stay quiet</h2>

<p>The bot should not answer when an agent is already in the conversation — nothing is worse than a machine interrupting a human mid-sentence. It also should not handle complaints. Someone who is angry needs a person, and a cheerful automated reply makes it worse.</p>

<p>Detecting a complaint reliably is hard. Detecting "this conversation has an agent in it" is trivial, and covers most of the damage.</p>

<h2>Read the transcripts weekly</h2>

<p>This is the part that gets skipped, and it is where the improvement comes from. Fifteen minutes a week reading what the bot got wrong will teach you more than any amount of configuration up front.</p>

<p>Watch for three patterns: questions it consistently misses, answers that are technically right but read badly, and handoffs that came too late.</p>

<h2>Measure whether it helped</h2>

<p>Not "messages handled" — a bot that handles a message badly still counts one. Better:</p>

<ul>
  <li>Conversations fully resolved without a human, where the customer did not come back unhappy</li>
  <li>Median first-reply time across all conversations (this should fall sharply)</li>
  <li>How often customers ask for a human in the first two messages — if this is high, the bot is in the way</li>
</ul>

<h2>The honest summary</h2>

<p>A WhatsApp chatbot is at its best answering simple questions instantly outside working hours, and at its worst standing between a frustrated customer and your team. Build the escape hatch first, keep the scope narrow, ground it in your real information, and read what it says.</p>
`,
  },

  {
    slug: "quotation-to-payment-on-whatsapp",
    title: "From quotation to payment without leaving WhatsApp",
    excerpt:
      "The gap between agreeing a price in a chat and getting paid is where deals go cold. Closing it is mostly about removing steps, not adding software.",
    category: "Sales",
    published: "2026-09-08",
    readingMinutes: 5,
    keywords: [
      "whatsapp invoice",
      "send quotation on whatsapp",
      "whatsapp payment link",
      "whatsapp sales process",
    ],
    html: `
<p>A customer messages, asks about a product, likes the price, and says yes. Then someone opens a laptop, types the details into accounting software, exports a PDF, emails it, and the customer — who has been on WhatsApp this whole time — does not open the email for two days.</p>

<p>That gap is where a surprising number of agreed deals quietly die. Not from objections. From friction.</p>

<h2>Every extra step costs conversions</h2>

<p>Count the steps between "yes" and "paid" in your business. For most it looks like: switch app, re-enter customer details, generate document, switch channel, wait, chase, resend, chase again.</p>

<p>Each switch is a place the process stalls, and each re-entry is a place a wrong number gets typed. The improvement is almost never a better tool for one of those steps — it is removing steps.</p>

<h2>What good looks like</h2>

<p>The customer agrees in the chat. The agent creates the quotation from the same screen, with the customer's details already attached because the conversation knows who they are. The PDF goes into the thread they are already reading. They accept, and it becomes an invoice with a payment link in the same conversation.</p>

<p>No app switching, no re-keying, no email that sits unopened.</p>

<h2>Send a document, not just a number</h2>

<p>It is tempting to type "that'll be 1,450 total" and move on. For small transactions, fine. For anything a customer needs to think about or justify to someone else, a proper document does real work:</p>

<ul>
  <li>It looks like a business rather than a conversation, which matters for larger amounts</li>
  <li>It states what is included, which prevents the argument later</li>
  <li>It can be forwarded to whoever actually approves the spend</li>
  <li>It carries a validity date, which creates a reason to decide</li>
</ul>

<p>That last point is underused. "Valid for 14 days" is not a pressure tactic; it is a deadline, and deadlines are what turn intentions into decisions.</p>

<h2>Mind the 24-hour window</h2>

<p>This shapes follow-up more than most teams realise. While the customer has messaged you within the last day, you can write freely. After that, reaching them requires an approved template, which costs money and reads more formally.</p>

<p>The practical consequence: send the quotation while the conversation is live, and if it goes quiet, one good follow-up the same day is worth more than three the following week. Our <a href="/blog/whatsapp-message-templates-that-get-approved">guide to templates</a> covers getting a payment-reminder template approved before you need it.</p>

<h2>Chase in a way that does not annoy</h2>

<p>A reasonable rhythm for an unanswered quotation:</p>

<ol>
  <li><strong>Same day, in the window:</strong> a short, human message — "sent that over, shout if anything needs changing."</li>
  <li><strong>Around day three:</strong> an approved template that adds something rather than repeating — stock, a delivery slot, the validity date.</li>
  <li><strong>Near expiry:</strong> one final note that the quotation is about to lapse.</li>
</ol>

<p>Then stop. Continuing past that earns blocks, and blocks damage the number your entire customer base uses.</p>

<h2>Track the two numbers that matter</h2>

<ul>
  <li><strong>Quotation to acceptance rate.</strong> If it is low, the problem is usually price or clarity, not chasing.</li>
  <li><strong>Days from acceptance to payment.</strong> If this is long, the problem is how easy you have made paying.</li>
</ul>

<p>They point at different fixes, which is exactly why they are worth separating.</p>
`,
  },

  {
    slug: "whatsapp-crm-for-uae-businesses",
    title: "WhatsApp CRM for UAE businesses: what to get right locally",
    excerpt:
      "WhatsApp is the default business channel across the Gulf. Trade licences, VAT on invoices, Arabic and English, and Ramadan hours all change how you set it up.",
    category: "Guides",
    published: "2026-09-08",
    readingMinutes: 6,
    keywords: [
      "whatsapp crm uae",
      "whatsapp business api dubai",
      "crm for dubai businesses",
      "whatsapp business uae",
    ],
    html: `
<p>In much of the Gulf, WhatsApp is not one channel among several — it is where business is done. Customers message rather than call, expect a reply the same hour, and will move to whichever supplier answers first.</p>

<p>That makes the setup details matter more here than in markets where email still carries the load. A few are specific to the region.</p>

<h2>Verification and your trade licence</h2>

<p>Meta business verification is a documents check, and the mismatch that trips UAE businesses most often is the licence name against the trading name.</p>

<p>A licence reading "Al Noor General Trading L.L.C." and a Meta Business account reading "Al Noor Electronics" is a rejection. Enter the legal name exactly as printed — including the L.L.C. — and use the trading name as your WhatsApp display name instead. Make sure the trading name appears clearly on your website, because that is the evidence a reviewer looks for when the two differ.</p>

<p>Your website also needs a visible address and phone number. A single-page site with only a contact form is thin evidence that a business exists.</p>

<h2>VAT belongs on the invoice</h2>

<p>If you are VAT-registered, your tax invoices must carry your TRN, the VAT amount shown separately, and the required invoice wording. Whatever generates your invoices needs to handle this natively.</p>

<p>Getting this wrong is not a formatting problem — it is a compliance problem that surfaces at the worst possible time. Configure the tax fields once, properly, before you send the first invoice from a new system.</p>

<h2>Two languages, one inbox</h2>

<p>Most Gulf businesses serve customers in both Arabic and English, often mixed within a single conversation. A few practical consequences:</p>

<ul>
  <li>Your team needs to reply in whichever language the customer opened in — switching them is friction.</li>
  <li>Message templates should be submitted in both languages. Meta approves them per language, so an English-only library leaves half your customers getting an English reminder.</li>
  <li>If you use an AI assistant, check its Arabic output with a native speaker before letting it answer customers unsupervised. Fluent-sounding and correct are not the same thing.</li>
</ul>

<h2>Working hours are not nine to five</h2>

<p>The working week is Monday to Friday in the UAE, with Saturday trading common in retail. Ramadan shifts hours substantially, and Friday afternoons are quiet.</p>

<p>Two things follow. Your away message should reflect the hours you actually keep, updated for Ramadan rather than left stale. And automated replies earn their keep in the evening — a customer messaging at nine at night who gets a real answer about stock and price is a customer who has stopped shopping around.</p>

<h2>Data protection</h2>

<p>The UAE's federal personal data protection law, and separate regimes inside the DIFC and ADGM, expect a lawful basis for processing personal data, a retention period, and a route for someone to request deletion. Saudi Arabia's PDPL imposes comparable obligations.</p>

<p>Conveniently, the record that keeps you compliant with Meta — who consented, when, to what wording, and when they opted out — is broadly the record a regulator would ask for. Keep it once, keep it properly. Our <a href="/blog/whatsapp-opt-in-that-protects-you">guide to opt-in</a> covers what that record should contain.</p>

<h2>Message costs vary by where your customers are</h2>

<p>Meta prices template messages by the recipient's country, and the differences are large. A business messaging customers across the GCC and the subcontinent will see quite different costs per market — worth checking against Meta's current rate card before you plan a campaign, rather than after.</p>

<h2>A sensible order to do things in</h2>

<ol>
  <li>Get your licence, website and Meta Business account saying the same thing</li>
  <li>Decide whether to migrate your known number or start fresh</li>
  <li>Submit templates in Arabic and English early</li>
  <li>Configure VAT and your TRN before the first invoice</li>
  <li>Set real working hours, and an evening bot that answers stock and price</li>
  <li>Only then start campaigns — and only to people who opted in</li>
</ol>

<p>Businesses that skip to step six are the ones whose numbers get restricted in the first month.</p>
`,
  },
];

/**
 * Every published guide. Add a generated batch by importing it at the top and
 * spreading it here -- the blog index, the article pages and /sitemap.xml all
 * read from POSTS, so nothing else needs touching.
 *
 * No import cycle: comparisons.ts -> define.ts -> blog.ts is a type-only
 * import, which is erased at compile time.
 */
export const POSTS: Post[] = [
  ...CORE_POSTS,
  ...COMPARISON_POSTS,
  ...BUYING_POSTS,
  ...LEAD_CAPTURE_POSTS,
  ...AI_POSTS,
];

/** Newest first, which is the order both the index and the sitemap want. */
export const POSTS_BY_DATE = [...POSTS].sort((a, b) => b.published.localeCompare(a.published));

export function findPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export const CATEGORIES = [...new Set(POSTS.map((p) => p.category))];
