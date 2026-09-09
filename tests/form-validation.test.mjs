// The rules that decide whether a form can save bad input.
//
// Each of these came from a live QA pass where a button was enabled when it
// should not have been, so the tests are written as the tester's sentence
// rather than as a description of the implementation.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  contentDraftBlocker,
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
