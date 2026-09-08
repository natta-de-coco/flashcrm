import { defineArticles } from "./define";

export const SALES_POSTS = defineArticles([
  {
    slug: "whatsapp-sales-pipeline-stages",
    title: "WhatsApp sales pipeline stages that reflect real progress",
    excerpt: "Define practical sales stages for WhatsApp enquiries, qualification and quotations so an active chat is not mistaken for a likely sale.",
    category: "Sales",
    keywords: ["whatsapp sales pipeline", "crm pipeline stages", "whatsapp lead management"],
    html: `
<p>A lively WhatsApp conversation can make an opportunity feel advanced even when the customer has not confirmed what they need. Sales stages should describe evidence of progress, not the number of messages exchanged or the agent's optimism.</p>
<h2>Give each stage an entry condition</h2>
<p>Begin with a small set of stages that the team can explain. A new enquiry has arrived. A qualified opportunity has a relevant requirement and enough information for a next step. A quotation has actually been prepared and sent. A won opportunity meets the business's agreed completion rule.</p>
<p>These definitions are a suggested process. Map them to the stages your CRM supports rather than assuming every label can be customised. Flas's <a href="/features">contacts and pipeline features</a> provide the workflow to evaluate.</p>
<table><thead><tr><th>Working stage</th><th>Evidence required</th><th>Next action</th></tr></thead><tbody>
<tr><td>New</td><td>A genuine enquiry is received</td><td>Assign and clarify the requirement</td></tr>
<tr><td>Qualified</td><td>The need and likely next step are understood</td><td>Prepare the appropriate response or quotation</td></tr>
<tr><td>Quotation sent</td><td>The current document has been issued</td><td>Agree how and when to follow up</td></tr>
<tr><td>Won</td><td>The business's completion condition is met</td><td>Hand over fulfilment and financial follow-through</td></tr>
<tr><td>Lost or inactive</td><td>The outcome or lack of current action is recorded</td><td>Close clearly without inventing a reason</td></tr>
</tbody></table>
<h2>Keep conversation status separate</h2>
<p>A chat can be waiting for the customer while the opportunity is qualified. It can be resolved while an invoice remains outstanding. Use the inbox state to manage communication and the sales stage to describe commercial progress.</p>
<p>If the two are confused, agents may close a chat and accidentally treat the sale as complete. During training, walk through one customer who has received an answer but still needs internal approval before buying.</p>
<h2>Require an owner and a next action</h2>
<p>A stage without a responsible person is a label, not a process. Every active opportunity should have someone who knows what happens next. “Follow up” is less useful than “Ask whether the revised quantity is approved on Thursday.”</p>
<p>When the next step is genuinely unknown, record the uncertainty. Do not create a fictional date simply to satisfy a field. Decide who will resolve the uncertainty and when the record should be reviewed.</p>
<h2>Review movement, not just totals</h2>
<p>Look for quotations that remain unchanged for a long time and new enquiries that never become qualified or closed. Read a few examples before blaming the salesperson. The cause might be unclear requirements, slow pricing approval or a stage definition nobody understands.</p>
<p>Use the <a href="/blog/whatsapp-lead-qualification-questions">qualification questions</a> to improve the early stages and the <a href="/blog/whatsapp-quotation-follow-up">quotation follow-up guide</a> for the middle. The pipeline should explain the next decision the business needs to make.</p>
`,
  },
  {
    slug: "whatsapp-quotation-follow-up",
    title: "How to follow up on a WhatsApp quotation without nagging",
    excerpt: "Make quotation follow-ups useful by referring to the current document, resolving uncertainty and agreeing on a realistic next step.",
    category: "Sales",
    keywords: ["whatsapp quotation follow up", "sales quote follow up", "whatsapp sales messages"],
    html: `
<p>“Any update?” is easy to send and difficult for a customer to act on. A useful quotation follow-up identifies the document, recalls the decision being made and offers help with the detail that may be holding it up.</p>
<h2>Agree on the next step when you send the quote</h2>
<p>Ask when the customer expects to review it and whether somebody else must approve it. Do not impose an arbitrary daily follow-up schedule. A buyer waiting for a weekly purchasing meeting has a different timeline from someone arranging an urgent repair.</p>
<p>Record the agreed action with the quotation reference. This prevents another agent from sending a generic reminder without understanding the conversation.</p>
<h2>Check the document before contacting the customer</h2>
<p>Confirm that you are referring to the latest version and that its price, quantity and validity still apply. If the customer requested a revision, send or clarify that revision before asking for a decision. Following up on an obsolete quotation makes the business look inattentive.</p>
<p>Flas's <a href="/features">quotation and invoice tools</a> sit alongside the customer workflow. Use the available record to keep the current document identifiable. The <a href="/blog/quotation-revision-control-whatsapp">revision control guide</a> explains the working discipline.</p>
<h2>Use a message with a purpose</h2>
<blockquote><p>Hi Sam, I am following up on quotation Q-104 for the office chairs. You mentioned reviewing the delivery date with your team. Would a revised delivery option help you make the decision?</p></blockquote>
<p>This is an illustrative draft to adapt to a genuine conversation. It names the quote, remembers the open issue and gives the customer an easy way to respond. Before sending through the API, use the message format permitted for that conversation and check the applicable template requirements.</p>
<h2>Respond to the reason, not just the silence</h2>
<table><thead><tr><th>Customer response</th><th>Useful next move</th></tr></thead><tbody>
<tr><td>Waiting for approval</td><td>Ask what the approver needs and agree a review point</td></tr>
<tr><td>Price concern</td><td>Clarify scope and alternatives without inventing a discount</td></tr>
<tr><td>Timing changed</td><td>Update the requirement and check validity</td></tr>
<tr><td>No longer needed</td><td>Close the opportunity respectfully</td></tr>
</tbody></table>
<p>Not every delayed decision is an objection to overcome. The customer's project may have changed. Record that honestly so the pipeline does not remain full of opportunities with no current action.</p>
<h2>Know when to stop</h2>
<p>If repeated appropriate follow-ups receive no response, move the opportunity out of active chasing according to your team's process. Respect requests to stop. A contact staying in the CRM does not mean staff should keep sending reminders indefinitely.</p>
<p>Use the <a href="/blog/whatsapp-sales-pipeline-stages">pipeline guide</a> to distinguish an open decision from an inactive lead. End each useful exchange with a clear next action, even when that action is to close the opportunity.</p>
`,
  },
  {
    slug: "quotation-revision-control-whatsapp",
    title: "Quotation revision control for WhatsApp sales teams",
    excerpt: "Keep quantities, prices and document versions clear when customers revise quotations over WhatsApp and several agents share the sale.",
    category: "Sales",
    keywords: ["quotation revision control", "whatsapp quotation management", "sales document versions"],
    html: `
<p>A customer approves “the quote” after three different PDFs have been sent in the same chat. One contains the old quantity, one changes delivery and one corrects the price. Unless the team can identify the current document, approval is ambiguous.</p>
<h2>Give the quotation a stable reference</h2>
<p>Use the document reference supported by your sales system and a clear convention for revisions. The exact format matters less than consistency. Staff should be able to say which version is current and why an earlier version should no longer be used.</p>
<p>Do not rely on filenames such as “final-final-new.pdf.” A filename copied into a chat is a poor substitute for a document record and a short explanation of what changed.</p>
<h2>Record changes before recreating the document</h2>
<p>When the customer changes the request, summarise the new requirement first. Confirm quantity, item, delivery assumptions and any other affected terms. This prevents an agent from correcting one line while accidentally carrying forward another outdated detail.</p>
<table><thead><tr><th>Change</th><th>Check before sending</th></tr></thead><tbody>
<tr><td>Quantity</td><td>Unit price, total and availability assumptions</td></tr>
<tr><td>Product</td><td>Specification, compatibility and delivery</td></tr>
<tr><td>Delivery location</td><td>Service coverage and applicable charges</td></tr>
<tr><td>Timing</td><td>Validity and the business's ability to fulfil</td></tr>
</tbody></table>
<h2>Explain the revision in the conversation</h2>
<p>Send a short note identifying the revised document and the material changes. For example: “This revision changes the quantity to twenty and updates delivery to the new address. Please use this version for your review.” Adapt the wording to the actual facts and the permitted message format.</p>
<p>Do not ask the customer to compare two long PDFs unaided when you already know what changed. The explanation helps both the buyer and the next agent handling the opportunity.</p>
<h2>Make handover possible</h2>
<p>Flas includes branded quotation PDFs in its <a href="/features">sales features</a>. Check the document handling available in your workspace and maintain a clear current-reference note. Do not assume automatic revision tracking exists merely because the software can generate a PDF.</p>
<p>A colleague should be able to find the latest quotation, the customer's outstanding question and the next action without asking the original salesperson. If not, the record needs another sentence of context.</p>
<h2>Confirm what was accepted</h2>
<p>When the customer agrees, reference the specific quotation and confirm any unresolved changes before moving to the next commercial step. If the acceptance message is unclear, clarify rather than choosing the version most convenient for the business.</p>
<p>Use the <a href="/blog/whatsapp-quotation-follow-up">follow-up guide</a> for the review period and the <a href="/blog/quotation-to-invoice-handoff">quotation-to-invoice handoff</a> for the next stage. The goal is a shared understanding of the current offer, not simply a tidy folder of PDFs.</p>
`,
  },
  {
    slug: "quotation-to-invoice-handoff",
    title: "From approved quotation to invoice: a clean WhatsApp handoff",
    excerpt: "Carry the accepted scope from quotation to invoice with clear references, responsible staff and checks that prevent avoidable rework.",
    category: "Sales",
    keywords: ["quotation to invoice workflow", "whatsapp invoicing workflow", "sales finance handoff"],
    html: `
<p>A customer approves a quotation, but the invoice is prepared from an earlier version or sent to the wrong contact. The sale was not lost at the conversation stage; the handoff failed after agreement. A short set of checks can prevent that avoidable rework.</p>
<h2>Identify the accepted commercial record</h2>
<p>Before preparing the invoice, confirm the quotation reference and current scope. Check whether the customer accepted the full offer or only part of it. A message saying “go ahead with ten” needs to be reconciled with a quotation that lists twenty.</p>
<p>Record who confirmed the acceptance and which details remain unresolved. Do not move uncertainty into an invoice and expect the finance team to reconstruct the conversation later.</p>
<h2>Use a handoff that answers practical questions</h2>
<table><thead><tr><th>Information</th><th>Why the receiving person needs it</th></tr></thead><tbody>
<tr><td>Accepted quotation reference</td><td>To use the correct scope and amounts</td></tr>
<tr><td>Customer billing details</td><td>To prepare the document for the correct customer</td></tr>
<tr><td>Delivery or service details</td><td>To keep fulfilment aligned with the agreement</td></tr>
<tr><td>Agreed payment terms</td><td>To avoid inventing a due date or deposit requirement</td></tr>
<tr><td>Responsible contact</td><td>To resolve questions without restarting the sales discussion</td></tr>
</tbody></table>
<p>This is an operational checklist, not a substitute for your business's accounting requirements. Use the approved document settings and internal review process applicable to the transaction.</p>
<h2>Prepare and inspect the actual invoice</h2>
<p>Flas includes quotations, invoices and credit notes as branded PDFs in its <a href="/features">sales module description</a>. Test the document workflow with a sample transaction. Do not assume the invoice inherits every detail correctly without checking the generated output.</p>
<p>Review the customer identity, line items, quantities and references. If a colleague prepares the invoice, they should be able to explain where each material detail came from. That is a stronger control than relying on familiarity with the customer.</p>
<h2>Send with enough context</h2>
<p>Identify the invoice and the accepted quotation in the message. Explain the agreed next step plainly, without adding new terms that were not discussed. Make it easy for the customer to ask about a discrepancy before the work proceeds.</p>
<p>If the customer replies to the salesperson with a billing question, transfer that question with the document reference and a named owner. The customer should not need to find a different department and repeat the whole story.</p>
<h2>Keep sales and payment states distinct</h2>
<p>An accepted quotation, an issued invoice and a recorded payment are separate events. Decide what each means in your pipeline and review process. Avoid marking a balance paid because the customer said they had arranged a transfer.</p>
<p>Use the <a href="/blog/quotation-revision-control-whatsapp">revision guide</a> before the handoff and the <a href="/blog/whatsapp-payment-status-team-workflow">payment-status workflow</a> afterward. The handoff is complete when the next person has the accepted facts and knows what they are responsible for.</p>
`,
  },
  {
    slug: "whatsapp-payment-status-team-workflow",
    title: "Keep payment status clear when sales happen on WhatsApp",
    excerpt: "Separate customer payment messages from verified internal records so sales and finance teams can coordinate invoice follow-through clearly.",
    category: "Operations",
    keywords: ["whatsapp payment tracking", "crm invoice payment status", "sales payment follow up"],
    html: `
<p>“I have paid” is useful information from a customer, but it is not the same event as your business confirming the payment against the correct invoice. Teams need a clear way to move between those states without asking the customer the same question repeatedly.</p>
<h2>Define the states in plain language</h2>
<p>Keep the working distinctions simple: invoice issued, customer reports payment, payment being checked and payment recorded. Map these to the statuses and notes your system supports. The wording should make it clear when staff are reporting a customer statement and when an authorised person has confirmed the record.</p>
<p>Do not invent extra financial states merely to make a dashboard look detailed. Add a distinction only if it changes who needs to act.</p>
<h2>Name the person who can confirm the record</h2>
<p>The sales agent can acknowledge the message and pass the invoice reference to the responsible person. The person checking payments should use the business's approved reconciliation process. A screenshot in a chat may assist an enquiry, but staff should not treat it as the sole source of truth.</p>
<table><thead><tr><th>Event</th><th>Owner's next action</th></tr></thead><tbody>
<tr><td>Customer says payment was sent</td><td>Acknowledge and pass the correct reference for checking</td></tr>
<tr><td>Reference is unclear</td><td>Ask for the minimum information needed to identify it</td></tr>
<tr><td>Payment is confirmed internally</td><td>Update the authorised record and inform the relevant team</td></tr>
<tr><td>Amount or invoice differs</td><td>Resolve the discrepancy before marking the item complete</td></tr>
</tbody></table>
<h2>Keep the conversation connected to the document</h2>
<p>Flas describes invoice payment tracking and running balances on its <a href="/features">feature page</a>. Test the workflow in your account and decide who may make updates. Do not assume a message from the customer automatically reconciles a bank transaction.</p>
<p>Use the invoice reference in internal handovers. A customer may have several invoices, partial payments or multiple people contacting your business. The reference is more reliable than “the payment from yesterday.”</p>
<h2>Acknowledge without overpromising</h2>
<p>A helpful response can say that the team has received the update and is checking it. Avoid promising immediate dispatch unless your fulfilment process allows that step. The customer deserves a clear expectation, and the operations team needs a record it can trust.</p>
<p>If checking takes longer than expected, assign someone to provide the next update. Silence between departments can turn a routine reconciliation into an unnecessary customer complaint.</p>
<h2>Review exceptions regularly</h2>
<p>Look for invoices where the customer reported payment but no internal decision followed. Investigate unclear references and inconsistent ownership. Fix the process that caused the delay rather than sending repeated reminders from different agents.</p>
<p>Use the <a href="/blog/quotation-to-invoice-handoff">quotation-to-invoice guide</a> to preserve the document chain and the <a href="/blog/whatsapp-shift-handover-checklist">handover checklist</a> to keep pending checks visible. Clear payment status is a coordination habit supported by software.</p>
`,
  },
  {
    slug: "whatsapp-shift-handover-checklist",
    title: "A WhatsApp shift handover checklist that saves the next agent time",
    excerpt: "Hand over WhatsApp conversations with the current requirement, commitments and next action so customers do not have to repeat themselves.",
    category: "Operations",
    keywords: ["whatsapp shift handover", "shared inbox handoff checklist", "customer conversation handover"],
    html: `
<p>The next agent should not have to read an entire chat to discover that the customer is waiting for a revised delivery date. A good handover records the current state of the work, especially what the business has already promised.</p>
<h2>Write for someone who was not present</h2>
<p>Start with the customer's current requirement, not a chronological summary of every message. Then record the unresolved question, the latest relevant document and the next action. Use specific nouns and dates instead of “this,” “that” and “tomorrow” when those could become ambiguous.</p>
<p>For example: “Customer needs twenty chairs for one office. Revised quotation Q-104 sent. Delivery date needs operations confirmation. Maya will check by Thursday afternoon.” This is an illustrative internal note, not a real customer record.</p>
<h2>Use five handover fields</h2>
<ol><li><strong>Current requirement:</strong> what the customer wants now.</li><li><strong>Commitment:</strong> what the business has promised to do.</li><li><strong>Reference:</strong> the relevant quotation, invoice or opportunity.</li><li><strong>Next action:</strong> the specific task still outstanding.</li><li><strong>Owner:</strong> who has accepted responsibility for it.</li></ol>
<p>If there is no remaining action, close the work according to your process. If it is waiting on the customer, say exactly what is awaited. A vague “pending” note forces the next shift to investigate from scratch.</p>
<h2>Transfer responsibility, not just visibility</h2>
<p>A shared inbox means colleagues can see the conversation; it does not mean someone has accepted the next step. In Flas, use the assignment and status capabilities described on the <a href="/features">feature page</a> and confirm that the receiving agent knows the handover exists.</p>
<p>For sensitive or complex exceptions, add a brief direct internal briefing through your normal team process. Keep the durable facts in the record so the handover does not depend entirely on a private conversation.</p>
<h2>Include what should not be assumed</h2>
<p>If a price is awaiting approval or a delivery slot is unconfirmed, make that explicit. The next agent may otherwise treat a suggested option as a promise. Distinguish what the customer requested from what the business accepted.</p>
<p>Likewise, identify any current chatbot involvement. The receiving person should know whether an automated response is still active and what the customer has already been told.</p>
<h2>Review a small sample at shift change</h2>
<p>Have the incoming agent explain the next action for a few handed-over conversations. If they cannot, improve the notes immediately. This is a practical quality check and a useful way to train new staff without creating a long manual.</p>
<p>Use the <a href="/blog/whatsapp-inbox-daily-review">daily inbox review</a> to catch unowned work and the <a href="/blog/quotation-revision-control-whatsapp">quotation revision guide</a> for document-heavy handovers. The handover succeeds when the customer can continue naturally with the next person.</p>
`,
  },
  {
    slug: "whatsapp-inbox-daily-review",
    title: "A daily WhatsApp inbox review for missed enquiries and stalled sales",
    excerpt: "Review unassigned conversations, waiting customers and stalled quotations with a short daily routine that gives every issue a next action.",
    category: "Operations",
    keywords: ["whatsapp inbox management", "daily crm review", "missed whatsapp enquiries"],
    html: `
<p>An inbox can look under control because agents are replying to new messages while older enquiries remain unresolved. A daily review should find work that has become invisible, especially conversations without an owner or a clear next action.</p>
<h2>Start with unowned work</h2>
<p>Check new and unassigned conversations first. Confirm whether each is a sales enquiry, support request, irrelevant message or something needing clarification. Assign a responsible person to genuine work. Do not distribute conversations randomly without considering who can answer the question.</p>
<p>Flas's <a href="/features">shared inbox features</a> include assignment, tags and statuses. Use them to make responsibility visible, then verify that staff understand what the labels mean.</p>
<h2>Look at the oldest waiting items</h2>
<p>Review conversations where the business owes the next action. A customer waiting for stock confirmation should not be hidden among conversations waiting for the customer's reply. If your current view mixes the two, use the supported status or note process to make the distinction clearer.</p>
<p>Read the actual exchange before deciding that an agent is late. The conversation may contain an agreed future date. The review should identify unmet commitments, not punish staff for keeping a customer's chosen timeline.</p>
<h2>Inspect stalled quotations separately</h2>
<table><thead><tr><th>Item</th><th>Question</th></tr></thead><tbody>
<tr><td>Quotation awaiting review</td><td>Was a follow-up point agreed?</td></tr>
<tr><td>Revision requested</td><td>Has the current requirement been turned into a new document?</td></tr>
<tr><td>Approval received</td><td>Who owns the invoice or fulfilment handoff?</td></tr>
<tr><td>No current response</td><td>Should the opportunity remain actively pursued?</td></tr>
</tbody></table>
<p>A resolved chat does not prove the commercial work is complete. Review the sales record as well as the communication queue.</p>
<h2>Turn each finding into an action</h2>
<p>A review that only counts problems creates a report, not progress. For each meaningful issue, record what happens next, who owns it and when it should be checked. Keep the wording specific enough that another person can verify completion.</p>
<p>If several issues have the same cause, fix that cause. Repeatedly missing product answers may point to outdated knowledge. Repeated quotation delays may require a pricing approval rule. Adding more reminders will not necessarily solve either problem.</p>
<h2>Keep the routine short enough to survive</h2>
<p>Start with a manageable time slot and a focused set of views. The duration should follow the workload, but avoid turning the daily check into a meeting that consumes the team's best reply time. Deep investigations can have separate owners.</p>
<p>Use the <a href="/blog/whatsapp-shift-handover-checklist">handover checklist</a> to improve continuity and the <a href="/blog/whatsapp-response-time-metrics">response metric guide</a> to understand delays. End the review with fewer ambiguous items than you started with, rather than a larger spreadsheet of concerns.</p>
`,
  },
  {
    slug: "whatsapp-response-time-metrics",
    title: "WhatsApp response-time metrics: measure a useful reply",
    excerpt: "Distinguish automated acknowledgements from useful human responses and review waiting time without rewarding empty speed.",
    category: "Operations",
    keywords: ["whatsapp response time", "customer support response metrics", "whatsapp inbox kpi"],
    html: `
<p>An instant “Thanks for your message” can make an inbox appear responsive while the customer still waits hours for an answer. Response-time reporting should distinguish acknowledgement from useful progress.</p>
<h2>Define the events before calculating the metric</h2>
<p>Record when the customer enquiry arrived, when an acknowledgement was sent and when the business provided a useful response. A useful response might answer the question, request a necessary detail or give a clear, owned next step. It should move the work forward.</p>
<p>Keep automated and human events distinguishable in the review. Automation may provide a genuinely useful answer, but its speed alone does not prove the customer was helped.</p>
<h2>Choose a time basis and state it</h2>
<p>Elapsed time includes evenings and closures. Staffed-hours time counts only the periods your team is available. Both can be informative, but they answer different questions. A customer experiences elapsed waiting, while a manager may also need to understand staffing performance.</p>
<p>Do not compare a staffed-hours figure from one month with an elapsed-hours figure from another. Keep the definitions beside the report and review whether the hours match the expectations shown on your website.</p>
<h2>Look beyond a single average</h2>
<table><thead><tr><th>Measure</th><th>What it helps reveal</th></tr></thead><tbody>
<tr><td>Median useful response time</td><td>The typical customer's wait</td></tr>
<tr><td>Long-wait sample</td><td>Conversations that averages can hide</td></tr>
<tr><td>Unanswered enquiries</td><td>Work that has not yet produced a response event</td></tr>
<tr><td>Reopened issues</td><td>Answers that may not have resolved the need</td></tr>
</tbody></table>
<p>You do not need every metric on day one. A careful manual sample can be more useful than a complex dashboard with poorly defined events.</p>
<h2>Connect the number to the workflow</h2>
<p>Flas provides a shared inbox and monitoring features described on its <a href="/features">feature page</a>. Check which timestamps and reports are available in your setup. Treat the measures in this guide as a reporting design, not a claim that every calculation is built into the product.</p>
<p>Read several slow conversations. Was the delay caused by assignment, missing product information, a quotation approval or an unclear handover? Each cause needs a different intervention. Asking everyone to “reply faster” does not fix a process that waits for one absent specialist.</p>
<h2>Do not make the metric easy to game</h2>
<p>If staff are rewarded only for first-response speed, they may send quick acknowledgements before understanding the question. Review answer quality and the next action alongside timing. A thoughtful clarification can be more valuable than a fast generic reply.</p>
<p>Use the <a href="/blog/whatsapp-inbox-daily-review">daily review</a> to find waiting work and the <a href="/blog/whatsapp-campaign-reply-capacity">campaign capacity guide</a> to prevent avoidable overload. A useful metric points toward a better customer experience, rather than merely a smaller number.</p>
`,
  },
  {
    slug: "whatsapp-support-to-sales-handoff",
    title: "Handing a WhatsApp conversation from support to sales",
    excerpt: "Recognise genuine buying interest during support conversations and transfer it with context, clear ownership and respect for the original issue.",
    category: "Sales",
    keywords: ["support to sales handoff", "whatsapp customer handoff", "customer service sales crm"],
    html: `
<p>A customer contacts support about an existing product and then asks about buying another one. That can become a useful sales conversation, but only if the original support need remains owned. A handoff should add help rather than make the customer repeat the problem to a different person.</p>
<h2>Resolve or clearly retain the original issue</h2>
<p>Before transferring anything, identify what still needs to happen on the support side. If the product problem is unresolved, keep a named owner for it. Buying interest should not cause the original request to disappear from view.</p>
<p>Ask whether the customer would like help with the new purchase. A mention of another product is not always an invitation to start a sales sequence. Follow the customer's intention rather than treating every support interaction as an upsell opportunity.</p>
<h2>Transfer the useful context</h2>
<ul><li>The product or service the customer already uses.</li><li>The support issue and its current state.</li><li>The new requirement the customer actually expressed.</li><li>Any timing or compatibility detail that affects the recommendation.</li><li>The person responsible for each remaining action.</li></ul>
<p>Keep the handoff factual. “Interested in an additional unit for another office” is more useful than “hot lead.” The salesperson needs the requirement, not an optimistic label.</p>
<h2>Make the customer-facing transition clear</h2>
<p>A short message can explain that a colleague will help with the new request while the original issue remains with its current owner. Avoid saying the customer must start again in another channel unless there is a practical reason.</p>
<p>In Flas, evaluate the <a href="/features">shared inbox assignment and contact pipeline</a> for this workflow. Check how your team preserves the support context while recording the new opportunity. Do not assume one conversation status can represent both jobs adequately.</p>
<h2>Test a conversation with two open actions</h2>
<p>Use a fictional customer waiting for a replacement accessory who also wants a quotation for a second unit. Ask one agent to manage the support action and another to handle the quotation. Then inspect whether both can identify what they owe the customer.</p>
<p>The test fails if either person assumes the other owns everything. It also fails if the customer receives conflicting updates because the commercial and support facts were not shared.</p>
<h2>Measure the quality of the handoff</h2>
<p>Review whether the customer had to repeat details, whether the original issue was completed and whether the sales next step was appropriate. Do not judge the support team only by the number of opportunities it creates. That can encourage unnecessary transfers and weaken service.</p>
<p>Use the <a href="/blog/whatsapp-shift-handover-checklist">handover checklist</a> for durable notes and the <a href="/blog/whatsapp-lead-qualification-questions">qualification guide</a> for the new requirement. A good transfer leaves the customer with more useful help and the business with clearer responsibility.</p>
`,
  },
  {
    slug: "whatsapp-crm-for-service-quotations",
    title: "WhatsApp CRM for service businesses that quote before they sell",
    excerpt: "Organise service enquiries around scope, site details, quotation revisions and follow-through when a fixed online price is not enough.",
    category: "Sales",
    keywords: ["whatsapp crm service business", "service quotation crm", "whatsapp lead to quote"],
    html: `
<p>A service business often cannot answer a price enquiry from a product list. The team needs to understand the scope, location and timing before preparing a useful quotation. A WhatsApp CRM should support that investigation without turning every conversation into a long form.</p>
<h2>Identify the facts that change the quotation</h2>
<p>For a fictional installation business, those facts might include the item to install, approximate size, site location and access constraints. For a cleaning service, they may include property type and the requested work. Use your own operation to choose the minimum useful details.</p>
<p>Separate information the customer can provide from information that requires a site assessment. Staff should not make a firm promise from an uncertain description merely because the customer wants a quick answer.</p>
<h2>Use the CRM to preserve the current scope</h2>
<p>Record a short current requirement and a named owner. When the customer changes the scope, update the working summary before preparing the next quotation. The chat history remains useful context, but it should not be the only way to discover what is currently being requested.</p>
<p>Flas combines a shared inbox, contacts, pipeline and branded quotation PDFs on its <a href="/features">feature page</a>. That combination is worth testing for a service team whose sales work moves through those steps. It does not by itself establish scheduling, field-service dispatch or specialist estimating capabilities.</p>
<h2>Make uncertainty visible</h2>
<table><thead><tr><th>Unknown</th><th>Useful next action</th></tr></thead><tbody>
<tr><td>Scope is incomplete</td><td>Ask the next question that changes the estimate</td></tr>
<tr><td>Site conditions are unclear</td><td>Arrange the business's normal assessment process</td></tr>
<tr><td>Timing is tentative</td><td>Record the customer's planning window</td></tr>
<tr><td>Approval requires another person</td><td>Prepare the information that person needs</td></tr>
</tbody></table>
<p>A tentative opportunity is not a bad opportunity. It simply needs a different next step from a customer who has confirmed all requirements.</p>
<h2>Keep the quote and the conversation aligned</h2>
<p>Before sending the document, compare it with the current scope. Explain any assumptions that affect the offer. If a later message changes the work, decide whether the quotation needs revision rather than treating the chat as an informal amendment nobody else can find.</p>
<p>When another employee takes over, they should know the latest document and what still requires confirmation. This is particularly important when the person answering messages is not the person delivering the service.</p>
<h2>Evaluate the complete job</h2>
<p>Trial a new enquiry, an incomplete requirement, a revised quotation and an accepted offer. Ask the receiving operations person whether the handoff is enough to continue through the business's normal fulfilment process.</p>
<p>Use the <a href="/blog/quotation-revision-control-whatsapp">revision guide</a> and <a href="/blog/quotation-to-invoice-handoff">invoice handoff checklist</a>. The value of a service CRM is a clearer path from a vague enquiry to an agreed piece of work.</p>
`,
  },
]);
