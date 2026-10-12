import { clampGreeting, liquidDoubleQuoted, safeOrigin, safeSiteKey } from "./plugin-encoding";
import { buildZip } from "./plugin-zip.server";

const VERSION = "1.0.0";

// The greeting is already liquidDoubleQuoted when it gets here. It sits in a
// double-quoted Liquid literal inside a single-quoted HTML attribute, and the
// whole value is printed through `escape`, so neither the default nor the
// store's own setting can end the attribute or open markup.
function popupSnippet(origin: string, siteKey: string, greeting: string): string {
  return `{% comment %}
  Flas CRM popup chatbot v${VERSION}
  Renders the slide-in AI chatbot that collects WhatsApp numbers and emails.
  Add {% render 'flas-crm-popup' %} just before </body> in layout/theme.liquid.
{% endcomment %}
<script
  src="${origin}/flas-popup.js"
  data-site-key="${siteKey}"
  data-platform="shopify"
  data-title="{{ settings.flas_popup_title | default: 'Chat with us' | escape }}"
  data-greeting='{{ settings.flas_popup_greeting | default: "${greeting}" | escape }}'
  data-accent="#25D366"
  data-brand="#075E54"
  async
></script>
`;
}

function leadSection(origin: string, siteKey: string): string {
  return `{% comment %}
  Flas CRM lead capture section v${VERSION}
  Inline email / WhatsApp signup form. Add it from the theme editor
  (Customize -> Add section -> Flas lead capture) on any template.
{% endcomment %}
<div
  data-flas-leads
  data-heading="{{ section.settings.heading | escape }}"
  data-cta="{{ section.settings.cta | escape }}"
></div>
<script src="${origin}/lead-capture.js" data-site-key="${siteKey}" async></script>

{% schema %}
{
  "name": "Flas lead capture",
  "settings": [
    {
      "type": "text",
      "id": "heading",
      "label": "Heading",
      "default": "Get our latest offers by email"
    },
    {
      "type": "text",
      "id": "cta",
      "label": "Button label",
      "default": "Subscribe"
    }
  ],
  "presets": [{ "name": "Flas lead capture" }]
}
{% endschema %}
`;
}

function install(origin: string, siteKey: string): string {
  return `=== Flas CRM for Shopify === v${VERSION}

What you get
------------
1. A slide-in AI chatbot that asks visitors for their name, WhatsApp number
   and email, then chats with them and files every lead into Flas CRM.
2. An optional inline signup section for newsletters and offers.

Install (2 minutes)
-------------------
1. In Shopify admin go to Online Store -> Themes, open the "..." menu on your
   live theme and choose "Edit code".
2. Under "Snippets" click "Add a new snippet", name it exactly:
      flas-crm-popup
   then paste the contents of snippets/flas-crm-popup.liquid and save.
3. Open layout/theme.liquid, find the closing </body> tag and add this line
   just above it:
      {% render 'flas-crm-popup' %}
   Save.
4. (Optional) Under "Sections" click "Add a new section", name it
      flas-lead-capture
   paste sections/flas-lead-capture.liquid and save. You can now add the
   "Flas lead capture" block from the theme editor on any page.
5. Open your storefront. The chat launcher appears bottom-right and your
   shop registers itself with Flas CRM automatically.

Go live
-------
6. In Flas CRM open Leads & Marketing, pick this site and either click
   "Activate now" (admins) or copy the activation link and open it once.
   Until the site is activated the popup collects nothing.

Your site key (already baked into the files above):
   ${siteKey}

Your workspace: ${origin}
`;
}

/** Builds the downloadable Shopify theme package for one connected site. */
export function buildShopifyPlugin(input: {
  origin: string;
  siteKey: string;
  greeting: string;
}): Uint8Array {
  // A key or address that cannot be written safely stops the build here.
  const origin = safeOrigin(input.origin);
  const siteKey = safeSiteKey(input.siteKey);
  return buildZip([
    {
      path: "flas-crm-shopify/snippets/flas-crm-popup.liquid",
      content: popupSnippet(origin, siteKey, liquidDoubleQuoted(clampGreeting(input.greeting))),
    },
    {
      path: "flas-crm-shopify/sections/flas-lead-capture.liquid",
      content: leadSection(origin, siteKey),
    },
    { path: "flas-crm-shopify/INSTALL.txt", content: install(origin, siteKey) },
  ]);
}
