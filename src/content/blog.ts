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

export const POSTS: Post[] = [
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
    title: "Getting your WhatsApp Business API number approved: the checklist Meta does not publish",
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
];

/** Newest first, which is the order both the index and the sitemap want. */
export const POSTS_BY_DATE = [...POSTS].sort((a, b) => b.published.localeCompare(a.published));

export function findPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export const CATEGORIES = [...new Set(POSTS.map((p) => p.category))];
