// The rules that decide whether a form can save bad input.
//
// Each of these came from a live QA pass where a button was enabled when it
// should not have been, so the tests are written as the tester's sentence
// rather than as a description of the implementation.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  contentDraftBlocker,
  documentChargeBlocker,
  invoiceLineBlocker,
  lineText,
  manualSocialFormError,
  productFormError,
  salesDraftBlocker,
} from "../node_modules/.cache/flas-form-validation.mjs";

const product = (over = {}) => ({
  title: "LED panel",
  sku: "FL-200W",
  price: "249.00",
  description: "",
  image: "",
  ...over,
});

describe("adding a product", () => {
  it("accepts a normal product", () => {
    assert.equal(productFormError(product()), null);
  });

  it("refuses a negative price", () => {
    // min="0" is a native hint a controlled React input never enforces, so
    // typing -10 left Add product enabled and stored the negative price.
    assert.match(productFormError(product({ price: "-10" })), /negative/i);
  });

  it("refuses a negative price written in other forms", () => {
    for (const price of ["-0.01", "-1e3", "  -5  "]) {
      assert.match(productFormError(product({ price })), /negative/i, `allowed ${price}`);
    }
  });

  it("refuses a price that is not a number", () => {
    assert.match(productFormError(product({ price: "abc" })), /must be a number/i);
  });

  it("allows a blank price, which means unpriced rather than free", () => {
    assert.equal(productFormError(product({ price: "" })), null);
    assert.equal(productFormError(product({ price: "   " })), null);
  });

  it("allows zero, which is a legitimate price", () => {
    assert.equal(productFormError(product({ price: "0" })), null);
  });

  it("requires a title", () => {
    assert.match(productFormError(product({ title: "" })), /title/i);
    assert.match(productFormError(product({ title: "   " })), /title/i);
  });

  it("refuses an image that is not an http(s) URL", () => {
    assert.match(productFormError(product({ image: "javascript:alert(1)" })), /http/i);
    assert.match(productFormError(product({ image: "example.com/a.png" })), /http/i);
  });

  it("accepts a normal image URL", () => {
    assert.equal(productFormError(product({ image: "https://example.com/a.png" })), null);
    assert.equal(productFormError(product({ image: "HTTP://example.com/a.png" })), null);
  });
});

describe("saving a content draft", () => {
  it("refuses an entirely empty post", () => {
    // Both Save draft and Schedule were reachable on an untouched form; the
    // row then listed as "Untitled post" with nothing in it.
    assert.match(contentDraftBlocker({ title: "", body: "" }), /title or body/i);
  });

  it("refuses a whitespace-only post", () => {
    assert.match(contentDraftBlocker({ title: "   ", body: "\n\t " }), /title or body/i);
  });

  it("accepts a title alone", () => {
    assert.equal(contentDraftBlocker({ title: "Ramadan offer", body: "" }), null);
  });

  it("accepts a body alone", () => {
    assert.equal(contentDraftBlocker({ title: "", body: "Draft copy" }), null);
  });
});

const doc = (over = {}) => ({
  customer: { name: "", company: "" },
  items: [],
  ...over,
});

describe("saving a quotation draft", () => {
  it("refuses a document with nothing in it", () => {
    // This produced a blank 0.00 entry in the list.
    assert.match(salesDraftBlocker(doc()), /customer or a line item/i);
  });

  it("refuses whitespace-only content", () => {
    const state = doc({ customer: { name: "  ", company: " " }, items: [{ description: "   " }] });
    assert.match(salesDraftBlocker(state), /customer or a line item/i);
  });

  it("accepts a customer with no lines yet", () => {
    // An unfinished draft is legitimate and the UI says so; this rule is
    // deliberately far weaker than the one guarding Finalise.
    assert.equal(salesDraftBlocker(doc({ customer: { name: "Acme", company: "" } })), null);
  });

  it("accepts a company name alone", () => {
    assert.equal(salesDraftBlocker(doc({ customer: { name: "", company: "Acme LLC" } })), null);
  });

  it("accepts a line item before the customer is known", () => {
    assert.equal(salesDraftBlocker(doc({ items: [{ description: "Install" }] })), null);
  });

  it("tolerates a null description without throwing", () => {
    assert.match(salesDraftBlocker(doc({ items: [{ description: null }] })), /customer or a line/i);
  });
});

const meta = { idLabel: "IG user ID", tokenLabel: "Meta access token" };
const social = (over = {}) => ({
  label: "Client bakery IG",
  externalId: "17841400000000000",
  accessToken: "IGQVJYtoken",
  ...over,
});

describe("pasting a social access token", () => {
  it("accepts a complete form", () => {
    assert.equal(manualSocialFormError(social(), meta), null);
  });

  it("refuses an empty token", () => {
    // Save was gated on the display name alone, so this stored an account that
    // looked connected and failed on first sync.
    assert.match(manualSocialFormError(social({ accessToken: "" }), meta), /access token/i);
  });

  it("refuses a whitespace-only token", () => {
    assert.match(manualSocialFormError(social({ accessToken: "   " }), meta), /access token/i);
  });

  it("requires the account id, naming the platform's own label", () => {
    const err = manualSocialFormError(social({ externalId: "" }), meta);
    assert.match(err, /IG user ID/);
  });

  it("lets TikTok omit the account id, which it resolves from the token", () => {
    const tiktok = { idLabel: "Open ID", tokenLabel: "Access token", idOptional: true };
    assert.equal(manualSocialFormError(social({ externalId: "" }), tiktok), null);
  });

  it("still requires a token even when the id is optional", () => {
    const tiktok = { idLabel: "Open ID", tokenLabel: "Access token", idOptional: true };
    assert.match(
      manualSocialFormError(social({ externalId: "", accessToken: "" }), tiktok),
      /access token/i,
    );
  });

  it("requires a usable display name", () => {
    assert.match(manualSocialFormError(social({ label: "a" }), meta), /display name/i);
  });

  it("reports the missing token before the missing id", () => {
    // The message must name one thing at a time, in a stable order, or the
    // inline hint flickers between fields as the customer types.
    const err = manualSocialFormError(social({ externalId: "", accessToken: "" }), meta);
    assert.match(err, /access token/i);
  });
});

describe("a line's text comes from whichever field the form wrote", () => {
  // The line-item input labelled "Description shown on the PDF" writes `name`;
  // `description` is only set by picking a catalogue product. Reading
  // description alone made every hand-typed quotation unfinalisable.
  it("prefers name, the field the form actually writes", () => {
    assert.equal(lineText({ name: "Installation", description: "catalogue text" }), "Installation");
  });

  it("falls back to description for a catalogue line", () => {
    assert.equal(lineText({ name: "", description: "Solar panel 200W" }), "Solar panel 200W");
  });

  it("treats whitespace as empty", () => {
    assert.equal(lineText({ name: "   ", description: null }), "");
  });

  it("a hand-typed line counts as content for a draft", () => {
    // The reported bug: a filled-in line was treated as empty.
    const state = {
      customer: { name: "", company: "" },
      items: [{ name: "Hand-typed service", description: null }],
    };
    assert.equal(salesDraftBlocker(state), null);
  });
});

describe("invoice lines cannot carry values that corrupt the total", () => {
  const good = { name: "Widget", quantity: 2, unit_price: 100, discount_value: 0, tax_rate: 5 };

  it("accepts ordinary lines", () => {
    assert.equal(invoiceLineBlocker([good, { ...good, name: "Gadget" }]), null);
  });

  it("accepts numeric strings, which is what form inputs hold", () => {
    assert.equal(invoiceLineBlocker([{ ...good, quantity: "3", unit_price: "49.50" }]), null);
  });

  it("rejects a negative quantity and names the line", () => {
    // Why this is not cosmetic: lineTotals floors a line at 0 while
    // previewTotals sums the raw gross, so -2 x 100 displayed as 0.00 and
    // silently took 200 off the grand total sent to the customer.
    assert.equal(
      invoiceLineBlocker([{ ...good, quantity: -2 }]),
      "Quantity cannot be negative on Widget.",
    );
  });

  it("names an untitled line by its position", () => {
    const out = invoiceLineBlocker([good, { ...good, name: "", quantity: -1 }]);
    assert.match(out ?? "", /line 2/);
  });

  it("rejects a negative price, discount or tax rate", () => {
    assert.match(invoiceLineBlocker([{ ...good, unit_price: -1 }]) ?? "", /Price cannot be negative/);
    assert.match(
      invoiceLineBlocker([{ ...good, discount_value: -5 }]) ?? "",
      /Discount cannot be negative/,
    );
    assert.match(invoiceLineBlocker([{ ...good, tax_rate: -5 }]) ?? "", /Tax rate cannot be negative/);
  });

  it("rejects a value that is not a number", () => {
    assert.match(invoiceLineBlocker([{ ...good, quantity: "abc" }]) ?? "", /not a number/);
  });

  it("an empty document has no bad lines", () => {
    assert.equal(invoiceLineBlocker([]), null);
  });
});

describe("document-level charges cannot be negative", () => {
  it("accepts zero and missing charges", () => {
    assert.equal(documentChargeBlocker({}), null);
    assert.equal(documentChargeBlocker({ invoice_discount: 0, shipping: 0, additional_charges: 0 }), null);
  });

  it("rejects each negative charge by name", () => {
    assert.match(documentChargeBlocker({ invoice_discount: -10 }) ?? "", /invoice discount/);
    assert.match(documentChargeBlocker({ shipping: -1 }) ?? "", /Shipping/);
    assert.match(documentChargeBlocker({ additional_charges: "-3" }) ?? "", /Other charges/);
  });
});
