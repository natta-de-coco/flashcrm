// The side menu, 12 Oct audit. The owner opened the app, could not find where
// to post to social media, and saw only SEO entries. The menu was regrouped by
// the job a person does (Daily, Sell, Marketing, Set up, Platform) and the
// entries given plain names. These pin the result: the menu itself, that every
// entry opens a real screen and is written in all five languages, that the phone
// bar, the search palette and the Create menu say the same thing as the sidebar,
// that nothing that was reachable became unreachable, and that the Social posts
// screen says honestly that Flas saves and plans posts but does not publish them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import * as app from "../node_modules/.cache/flas-i18n.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

const { NAV_SECTIONS, MANAGER_SECTION, MESSAGES, navMessageKey } = app;
const LANGUAGES = ["en", "ar", "ms", "fil", "sw"];
const sections = [...NAV_SECTIONS, MANAGER_SECTION];
const items = sections.flatMap((section) => [...section.items]);
const menuRoutes = items.map((item) => item.to);
const label = (language, to) => MESSAGES[language][navMessageKey(to, "label")];
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/* ───────────────────────────── the menu itself ───────────────────────────── */

describe("the menu is the approved one", () => {
  const APPROVED = [
    [
      "daily",
      "Daily",
      [
        ["/dashboard", "Home"],
        ["/inbox", "Inbox"],
        ["/contacts", "Contacts"],
        ["/chatbot", "Chatbot"],
      ],
    ],
    [
      "sell",
      "Sell",
      [
        ["/sales", "Quotes & invoices"],
        ["/catalog", "Products"],
      ],
    ],
    [
      "marketing",
      "Marketing",
      [
        ["/social", "Social posts"],
        ["/seo-blog", "Website & SEO"],
        ["/marketing", "Leads & email"],
        ["/campaign-planner", "Campaign planner"],
        ["/advisor", "Business advisor"],
      ],
    ],
    [
      "setup",
      "Set up",
      [
        ["/connect", "Connect accounts"],
        ["/monitoring", "Alerts & health"],
        ["/settings", "Settings"],
      ],
    ],
    [
      "platform",
      "Platform",
      [
        ["/companies", "Companies"],
        ["/companies/errors", "Errors & issues"],
      ],
    ],
  ];

  it("has these sections, in this order, with these entries, in this order", () => {
    const actual = sections.map((section) => [
      section.id,
      section.title,
      section.items.map((item) => [item.to, item.label]),
    ]);
    assert.deepEqual(actual, APPROVED);
  });

  it("keeps the platform entries in their own section, apart from the rest", () => {
    assert.equal(MANAGER_SECTION.id, "platform");
    assert.deepEqual(
      NAV_SECTIONS.map((section) => section.id),
      ["daily", "sell", "marketing", "setup"],
    );
  });

  it("does not use any of the old names", () => {
    const old = [
      "Social Hub",
      "Content & SEO",
      "SEO Studio",
      "Leads & Marketing",
      "Business Advisor",
      "Campaign Planner",
      "Quotes & Invoices",
      "Integrations",
      "Monitoring",
    ];
    for (const item of items) {
      for (const name of old) {
        assert.notEqual(item.label, name, `${item.to} still says ${name}`);
        assert.ok(!item.desc.includes(name), `${item.to} description still says ${name}`);
      }
    }
  });
});

/* ───────────────────────── every entry opens a real screen ───────────────── */

describe("every route in the menu exists", () => {
  // The generated route tree is what the router serves.
  const tree = read("src/routeTree.gen.ts");
  const block = tree.slice(
    tree.indexOf("export interface FileRoutesByFullPath"),
    tree.indexOf("export interface FileRoutesByTo"),
  );
  const served = new Set(
    [...block.matchAll(/^\s+'([^']+)':/gm)].map((m) =>
      m[1] === "/" ? m[1] : m[1].replace(/\/$/, ""),
    ),
  );

  it("is a route the app serves", () => {
    assert.ok(served.size > 20, "could not read the route tree");
    for (const to of menuRoutes) assert.ok(served.has(to), `${to} is not a route`);
  });

  it("is listed once", () => {
    assert.equal(new Set(menuRoutes).size, menuRoutes.length);
  });

  it("has a name, a description and some search words", () => {
    for (const item of items) {
      assert.ok(item.label.trim(), `${item.to} has no label`);
      assert.ok(item.desc.trim(), `${item.to} has no description`);
      assert.ok(item.keywords?.trim(), `${item.to} has no search words`);
    }
  });
});

/* ───────────────────────── all five languages ────────────────────────────── */

describe("every label is written in all five languages", () => {
  it("has a section title in each", () => {
    for (const section of sections) {
      for (const language of LANGUAGES) {
        const text = MESSAGES[language][`nav.section.${section.id}`];
        assert.ok(text && text.trim(), `${language}: no title for section ${section.id}`);
      }
    }
  });

  it("has a name and a description for each entry, in each", () => {
    for (const item of items) {
      for (const part of ["label", "desc"]) {
        for (const language of LANGUAGES) {
          const text = MESSAGES[language][navMessageKey(item.to, part)];
          assert.ok(text && text.trim(), `${language}: ${item.to} has no ${part}`);
        }
      }
    }
  });

  it("shows the same English the menu definition holds", () => {
    for (const section of sections) {
      assert.equal(MESSAGES.en[`nav.section.${section.id}`], section.title);
    }
    for (const item of items) {
      assert.equal(MESSAGES.en[navMessageKey(item.to, "label")], item.label);
      assert.equal(MESSAGES.en[navMessageKey(item.to, "desc")], item.desc);
    }
  });

  it("leaves no old English name behind in another language", () => {
    const old =
      /Social Hub|Content & SEO|SEO Studio|Leads (&|at|dan) Marketing|Integrations|Mga Integrasyon/;
    for (const language of LANGUAGES) {
      for (const item of items) {
        for (const part of ["label", "desc"]) {
          const text = MESSAGES[language][navMessageKey(item.to, part)];
          assert.ok(!old.test(text), `${language} ${item.to} ${part}: "${text}"`);
        }
      }
    }
  });
});

describe("no two entries share a label", () => {
  for (const language of LANGUAGES) {
    it(`${language}: every entry and section is called something different`, () => {
      const names = [
        ...items.map((item) => label(language, item.to)),
        ...sections.map((section) => MESSAGES[language][`nav.section.${section.id}`]),
      ].map((name) => name.trim().toLowerCase());
      const twice = names.filter((name, index) => names.indexOf(name) !== index);
      assert.deepEqual(twice, []);
    });
  }
});

/* ───────────────── the sidebar, the phone bar, search and Create agree ───── */

describe("the sidebar, the phone bar and the search palette agree", () => {
  const inMenuOrder = (routes) => {
    const order = routes.map((to) => menuRoutes.indexOf(to));
    return order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1]));
  };

  it("the phone bar is made of menu entries, in menu order", () => {
    assert.ok(Array.isArray(app.MOBILE_BAR_ITEMS), "MOBILE_BAR_ITEMS is missing");
    const routes = app.MOBILE_BAR_ITEMS.map((item) => item.to);
    assert.deepEqual(routes, ["/dashboard", "/inbox", "/contacts", "/social"]);
    assert.ok(inMenuOrder(routes), "the bar is out of the menu's order");
  });

  it("the phone bar entries are the menu's own entries, so they carry the menu's names", () => {
    for (const tab of app.MOBILE_BAR_ITEMS) {
      const entry = items.find((item) => item.to === tab.to);
      assert.equal(tab.label, entry.label);
      assert.equal(tab.icon, entry.icon);
    }
  });

  it("the search palette lists every sidebar entry a company sees, and only those", () => {
    assert.ok(Array.isArray(app.PALETTE_PAGES), "PALETTE_PAGES is missing");
    assert.deepEqual(
      app.PALETTE_PAGES.map((page) => page.to),
      NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.to)),
    );
    for (const page of app.PALETTE_PAGES) {
      const entry = items.find((item) => item.to === page.to);
      assert.equal(page.label, entry.label);
      assert.equal(page.desc, entry.desc);
      assert.equal(page.keywords, entry.keywords);
    }
  });

  it("show the same name in every language, because they read the same text", () => {
    for (const language of LANGUAGES) {
      for (const tab of app.MOBILE_BAR_ITEMS) {
        const inSidebar = label(language, tab.to);
        const onBar = MESSAGES[language][navMessageKey(tab.to, "label")];
        assert.equal(onBar, inSidebar);
      }
    }
    const bar = read("src/components/MobileBottomNav.tsx");
    assert.ok(bar.includes("MOBILE_BAR_ITEMS"), "the bar builds its tabs from the menu");
    assert.ok(bar.includes("navMessageKey"), "the bar names its tabs with the menu's keys");
    assert.equal(bar.includes("bottomNav."), false, "the bar must not keep names of its own");

    const palette = read("src/components/CommandPalette.tsx");
    assert.ok(palette.includes("PALETTE_PAGES"), "the palette builds its pages from the menu");
    assert.ok(palette.includes("navMessageKey"), "the palette names pages with the menu's keys");

    const menu = read("src/routes/_authenticated/route.tsx");
    assert.ok(menu.includes("navMessageKey"));
    assert.ok(
      menu.includes("nav.section.${section.id}"),
      "section titles come from the section id",
    );
    assert.equal(menu.includes('section.title === "Manager"'), false);
    assert.ok(menu.includes('section.id === "platform"'));
    assert.ok(
      menu.includes("isSuperAdmin ? [...NAV_SECTIONS, MANAGER_SECTION] : NAV_SECTIONS"),
      "platform entries stay for platform staff only",
    );
  });
});

describe("the Create menu opens the same screens", () => {
  const actions = app.QUICK_CREATE_ACTIONS;
  const tree = read("src/routeTree.gen.ts");
  const served = (to) => tree.includes(`'${to}':`) || tree.includes(`'${to}/':`);

  it("is built from one list that the component reads", () => {
    assert.ok(Array.isArray(actions), "QUICK_CREATE_ACTIONS is missing");
    assert.ok(read("src/components/QuickCreate.tsx").includes("QUICK_CREATE_ACTIONS"));
  });

  it("only opens screens that exist and that a person can find in the menu", () => {
    const allowed = (to) =>
      menuRoutes.includes(to) ||
      (app.UNLISTED_ROUTES ?? []).includes(to) ||
      menuRoutes.some((route) => to.startsWith(`${route}/`));
    for (const action of actions) {
      assert.ok(served(action.to), `${action.to} is not a route`);
      assert.ok(allowed(action.to), `${action.to} is not reachable from the menu`);
    }
  });

  it("shows the English the list holds", () => {
    actions.forEach((action, index) => {
      assert.equal(MESSAGES.en[`quickCreate.action.${index}.label`], action.label);
      assert.equal(MESSAGES.en[`quickCreate.action.${index}.desc`], action.desc);
    });
  });

  it("is written in all five languages", () => {
    actions.forEach((_, index) => {
      for (const part of ["label", "desc"]) {
        for (const language of LANGUAGES) {
          const text = MESSAGES[language][`quickCreate.action.${index}.${part}`];
          assert.ok(text && text.trim(), `${language}: action ${index} has no ${part}`);
        }
      }
    });
  });

  it("does not use an old menu name or promise what Flas does not do", () => {
    const text = actions
      .map((_, index) =>
        ["label", "desc"].map((part) => MESSAGES.en[`quickCreate.action.${index}.${part}`]),
      )
      .flat()
      .join(" | ");
    for (const stale of [
      "Social Hub",
      "SEO Studio",
      "Content & SEO",
      "Image-to-post",
      "schedule",
    ]) {
      assert.ok(!text.toLowerCase().includes(stale.toLowerCase()), `Create still says ${stale}`);
    }
    assert.ok(!/WhatsApp campaign/.test(text), "the campaign screen only does email");
  });
});

/* ───────────────────── nothing that was reachable became unreachable ──────── */

describe("every screen that was reachable still is", () => {
  it("every route the role rules know about is in the menu or linked from inside the app", () => {
    assert.ok(Array.isArray(app.ALL_ROUTES));
    const unlisted = app.ALL_ROUTES.filter((to) => !menuRoutes.includes(to));
    assert.deepEqual(unlisted, ["/content"]);
    assert.deepEqual([...app.UNLISTED_ROUTES], ["/content"]);
  });

  it("every sidebar entry a company sees is under the role rules", () => {
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        assert.ok(app.ALL_ROUTES.includes(item.to), `${item.to} is not in ALL_ROUTES`);
      }
    }
  });

  it("/content is linked from Website & SEO, for the same people who can open it", () => {
    const hub = read("src/routes/_authenticated/seo-blog.index.tsx");
    assert.match(hub, /to="\/content"/, "the Website & SEO hub does not link to /content");
    assert.ok(hub.includes("seoBlogIndex.savedDrafts"), "the link is named Saved drafts");
    // Everyone who can open /content can open the hub that links to it.
    for (const role of ["company_admin", "marketing_manager", "seo_editor"]) {
      assert.ok(app.canReach(role, "/content"), role);
      assert.ok(app.canReach(role, "/seo-blog"), `${role} reaches the hub`);
    }
  });

  it("the Saved drafts screen carries its new name", () => {
    assert.equal(MESSAGES.en["content.contentSeo"], "Saved drafts");
  });

  it("people can still find the screens by the names they knew", () => {
    const haystack = (item) => `${item.label} ${item.desc} ${item.keywords ?? ""}`.toLowerCase();
    const find = (term) =>
      app.PALETTE_PAGES.filter((page) => haystack(page).includes(term)).map((page) => page.to);
    const expected = {
      "social hub": "/social",
      "seo studio": "/seo-blog",
      integrations: "/connect",
      monitoring: "/monitoring",
      leads: "/marketing",
      content: "/seo-blog",
      "social media": "/social",
      schedule: "/social",
      caption: "/social",
      "search console": "/seo-blog",
      google: "/seo-blog",
      newsletter: "/marketing",
      drip: "/marketing",
    };
    for (const [term, to] of Object.entries(expected)) {
      assert.ok(
        find(term).includes(to),
        `"${term}" should reach ${to}, got ${find(term).join(", ")}`,
      );
    }
  });

  it("no longer promises stock keeping or publishing in the search words", () => {
    const products = app.PALETTE_PAGES.find((page) => page.to === "/catalog");
    assert.ok(!products.keywords.includes("inventory"));
    for (const page of app.PALETTE_PAGES) {
      if (page.to === "/seo-blog") continue; // WordPress publishing is real there
      assert.ok(!/\bpublish\b/.test(page.keywords), `${page.to} says publish`);
    }
  });
});

/* ───────────────────────────────── the keys exist ─────────────────────────── */

describe("every key the menu surfaces use exists", () => {
  it("has the Saved drafts and Website & SEO titles in every language", () => {
    for (const key of [
      "seoBlogIndex.savedDrafts",
      "seoBlogIndex.seoStudio",
      "content.contentSeo",
    ]) {
      for (const language of LANGUAGES) {
        assert.ok(MESSAGES[language][key]?.trim(), `${language}: ${key}`);
      }
    }
    assert.equal(MESSAGES.en["seoBlogIndex.seoStudio"], "Website & SEO");
    assert.equal(MESSAGES.en["seoBlogIndex.savedDrafts"], "Saved drafts");
  });
});
