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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as app from "../node_modules/.cache/flas-i18n.mjs";
import * as navHook from "../node_modules/.cache/flas-nav-access-hook.mjs";

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
// Source without its comments, so a sentence that mentions a function does not count as a call.
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
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
        ["/companies/email-settings", "Platform email"],
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

  it("every surface takes its finished list from the one hook, so none of them can pick a role", () => {
    const bar = strip(read("src/components/MobileBottomNav.tsx"));
    const palette = strip(read("src/components/CommandPalette.tsx"));
    const create = strip(read("src/components/QuickCreate.tsx"));
    const menu = strip(read("src/routes/_authenticated/route.tsx"));
    assert.match(menu, /\{[^}]*\bsections\b[^}]*\}\s*=\s*useNavAccess\(\)/, "sidebar: sections");
    assert.match(bar, /\{[^}]*\bmobileBar\b[^}]*\}\s*=\s*useNavAccess\(\)/, "phone bar: mobileBar");
    assert.match(
      create,
      /\{[^}]*\bquickCreate\b[^}]*\}\s*=\s*useNavAccess\(\)/,
      "Create: quickCreate",
    );
    assert.match(
      palette,
      /\{[^}]*\bpalette\b[^}]*\bfindRecords\b[^}]*\}\s*=\s*useNavAccess\(\)/,
      "search: palette and findRecords",
    );
    // The effect that searches records must re-run when the role changes, and the
    // role reaches it only as findRecords.
    assert.match(palette, /\[\s*q\s*,\s*findRecords\b/, "the search effect depends on findRecords");
  });

  const SURFACES = [
    ["the sidebar", "src/routes/_authenticated/route.tsx"],
    ["the phone bar", "src/components/MobileBottomNav.tsx"],
    ["search", "src/components/CommandPalette.tsx"],
    ["Create", "src/components/QuickCreate.tsx"],
  ];
  const ROLE_WORDS = "super_admin|company_admin|marketing_manager|staff|seo_editor";

  for (const [name, file] of SURFACES) {
    it(`${name} (${file}) never names a role, filters by one, or reads the unfiltered menu`, () => {
      const source = strip(read(file));
      assert.match(source, /useNavAccess\(\)/, "the lists come from the hook");
      // Not the unfiltered menu...
      assert.doesNotMatch(
        source,
        /\b(NAV_SECTIONS|MANAGER_SECTION|PALETTE_PAGES|MOBILE_BAR_ITEMS|MOBILE_BAR_ROUTES|QUICK_CREATE_ACTIONS)\b/,
      );
      // ...no filter of its own, so no role argument to get wrong...
      assert.doesNotMatch(
        source,
        /\b(navSectionsFor|paletteFor|mobileBarFor|quickCreateFor|searchRecords|canOpen|canReach|routesFor|searchableRecords|isCompanyManager)\b/,
      );
      // ...no role written down, and no role read from anywhere else.
      assert.doesNotMatch(source, new RegExp(`["'\`](${ROLE_WORDS})["'\`]`));
      assert.doesNotMatch(source, /\bstaffRole\b/);
      assert.doesNotMatch(source, /\{[^}]*\brole\b[^}]*\}\s*=\s*useNavAccess/);
    });
  }

  it("the phone bar entries are the menu's own entries, so they carry the menu's names", () => {
    for (const tab of app.MOBILE_BAR_ITEMS) {
      const entry = items.find((item) => item.to === tab.to);
      assert.equal(tab.label, entry.label);
      assert.equal(tab.icon, entry.icon);
    }
  });

  it("the search palette lists every sidebar entry, the platform pages included", () => {
    assert.ok(Array.isArray(app.PALETTE_PAGES), "PALETTE_PAGES is missing");
    assert.deepEqual(
      app.PALETTE_PAGES.map((page) => page.to),
      menuRoutes,
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
    assert.match(bar, /\bmobileBar\b/, "the bar builds its tabs from the menu");
    assert.ok(bar.includes("navMessageKey"), "the bar names its tabs with the menu's keys");
    assert.equal(bar.includes("bottomNav."), false, "the bar must not keep names of its own");

    const palette = read("src/components/CommandPalette.tsx");
    assert.match(palette, /\bpalette\b/, "the palette builds its pages from the menu");
    assert.ok(palette.includes("navMessageKey"), "the palette names pages with the menu's keys");

    const menu = read("src/routes/_authenticated/route.tsx");
    assert.ok(menu.includes("navMessageKey"));
    assert.ok(
      menu.includes("nav.section.${section.id}"),
      "section titles come from the section id",
    );
    assert.equal(menu.includes('section.title === "Manager"'), false);
    // The platform section is no longer special-cased here: the same rule that
    // filters every other entry (canOpen) keeps it for platform staff only.
    assert.match(menu, /\bsections\b/, "the sidebar takes the shared, filtered sections");
    assert.equal(menu.includes("isSuperAdmin"), false, "no second, separate platform check");
  });
});

/* ──────── the one hook: each surface is handed the lists of the CALLER's role ──────── */

describe("useNavAccess hands every surface the lists of the signed-in role", () => {
  // The real hook, with hooks/useTenant swapped for tests/support/tenant-double.mjs,
  // rendered once per "signed-in person". Whatever it returns is what the sidebar,
  // phone bar, search and Create get, because they take their lists from here.
  const accessFor = (tenant) => {
    globalThis.__tenantDouble = tenant;
    let seen;
    const Probe = () => {
      seen = navHook.useNavAccess();
      return null;
    };
    try {
      renderToStaticMarkup(createElement(Probe));
    } finally {
      delete globalThis.__tenantDouble;
    }
    return seen;
  };
  const asRole = (staffRole) => accessFor({ staffRole, loading: false });
  const sidebarOf = (access) =>
    access.sections.flatMap((section) => section.items.map((item) => item.to));
  const paletteOf = (access) => access.palette.map((page) => page.to);
  const barOf = (access) => access.mobileBar.map((item) => item.to);
  const createOf = (access) => access.quickCreate.map(({ action }) => action.to);
  const tablesAsked = async (access) => {
    const asked = [];
    const client = {
      from(table) {
        asked.push(table);
        const query = {
          select: () => query,
          or: () => query,
          ilike: () => query,
          limit: async () => ({ data: [], error: null }),
        };
        return query;
      },
    };
    await access.findRecords(client, "ada");
    return asked.sort();
  };

  const EXPECTED = {
    seo_editor: {
      pages: ["/dashboard", "/seo-blog", "/settings"],
      bar: ["/dashboard"],
      create: ["/seo-blog/studio", "/content"],
      records: ["seo_articles"],
    },
    staff: {
      pages: ["/dashboard", "/inbox", "/contacts", "/sales", "/catalog", "/settings"],
      bar: ["/dashboard", "/inbox", "/contacts"],
      create: ["/contacts", "/inbox", "/catalog"],
      records: ["contacts", "products"],
    },
    marketing_manager: {
      pages: [
        "/dashboard",
        "/inbox",
        "/contacts",
        "/social",
        "/seo-blog",
        "/marketing",
        "/campaign-planner",
        "/advisor",
        "/settings",
      ],
      bar: ["/dashboard", "/inbox", "/contacts", "/social"],
      records: ["contacts", "seo_articles"],
    },
  };

  for (const [role, expected] of Object.entries(EXPECTED)) {
    it(`${role}: all four surfaces get this role's entries and no one else's`, async () => {
      const access = asRole(role);
      assert.deepEqual(sidebarOf(access), expected.pages);
      assert.deepEqual(paletteOf(access), expected.pages);
      assert.deepEqual(barOf(access), expected.bar);
      if (expected.create) assert.deepEqual(createOf(access), expected.create);
      assert.deepEqual(await tablesAsked(access), expected.records);
    });
  }

  it("an unknown role, a missing role, and a profile still loading get Home only and ask nothing", async () => {
    const cases = [
      asRole("owner"),
      asRole(null),
      asRole(""),
      accessFor(undefined),
      // Loading wins over whatever role was last known: nothing privileged until it is known.
      accessFor({ staffRole: "company_admin", loading: true }),
    ];
    for (const access of cases) {
      assert.deepEqual(sidebarOf(access), ["/dashboard"]);
      assert.deepEqual(paletteOf(access), ["/dashboard"]);
      assert.deepEqual(barOf(access), ["/dashboard"]);
      assert.deepEqual(createOf(access), []);
      assert.deepEqual(await tablesAsked(access), []);
    }
  });

  it("company admin gets the whole company menu and no platform pages; platform staff also get those", async () => {
    const admin = asRole("company_admin");
    assert.ok(sidebarOf(admin).includes("/settings"));
    assert.ok(!sidebarOf(admin).some((to) => to.startsWith("/companies")));
    assert.deepEqual(await tablesAsked(admin), ["contacts", "products", "seo_articles"]);
    const platform = asRole("super_admin");
    assert.ok(sidebarOf(platform).includes("/companies"));
    assert.ok(paletteOf(platform).includes("/companies/email-settings"));
  });

  it("the lists follow the role: one person's list is not another's", () => {
    const lists = ["seo_editor", "staff", "company_admin", "super_admin"].map((role) =>
      JSON.stringify(sidebarOf(asRole(role))),
    );
    assert.equal(new Set(lists).size, lists.length, "two roles were handed the same menu");
    // The hook's lists are the filters' lists for that role, nothing else.
    for (const role of [
      "seo_editor",
      "staff",
      "marketing_manager",
      "company_admin",
      "super_admin",
    ]) {
      const access = asRole(role);
      assert.deepEqual(access.sections, app.navSectionsFor(role));
      assert.deepEqual(access.palette, app.paletteFor(role));
      assert.deepEqual(access.mobileBar, app.mobileBarFor(role));
      assert.deepEqual(access.quickCreate, app.quickCreateFor(role));
    }
  });
});

describe("the Create menu opens the same screens", () => {
  const actions = app.QUICK_CREATE_ACTIONS;
  const tree = read("src/routeTree.gen.ts");
  const served = (to) => tree.includes(`'${to}':`) || tree.includes(`'${to}/':`);

  it("is built from one list that the component reads", () => {
    assert.ok(Array.isArray(actions), "QUICK_CREATE_ACTIONS is missing");
    assert.match(read("src/components/QuickCreate.tsx"), /\bquickCreate\b/);
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

/* ───────── F4: one permission rule for the sidebar, the bar, search and Create ──────── */

describe("one permission rule decides what every entry point offers", () => {
  // What each role should reach, written out by hand (not derived from the rule
  // under test). Screens only; a screen's child routes follow it.
  const REACHES = {
    company_admin: [
      "/dashboard",
      "/inbox",
      "/contacts",
      "/chatbot",
      "/sales",
      "/catalog",
      "/social",
      "/seo-blog",
      "/marketing",
      "/campaign-planner",
      "/advisor",
      "/connect",
      "/monitoring",
      "/settings",
    ],
    marketing_manager: [
      "/dashboard",
      "/inbox",
      "/contacts",
      "/social",
      "/seo-blog",
      "/marketing",
      "/campaign-planner",
      "/advisor",
      "/settings",
    ],
    staff: ["/dashboard", "/inbox", "/contacts", "/sales", "/catalog", "/settings"],
    seo_editor: ["/dashboard", "/seo-blog", "/settings"],
  };
  const PLATFORM = ["/companies", "/companies/errors", "/companies/email-settings"];
  REACHES.super_admin = [...REACHES.company_admin, ...PLATFORM];
  // A role that is not loaded yet, or that this file has never heard of.
  const UNKNOWN = [undefined, null, "", "owner", "admin", "Staff", "__proto__", "constructor"];

  const sidebarRoutes = (role) =>
    app.navSectionsFor(role).flatMap((section) => section.items.map((item) => item.to));
  const paletteRoutes = (role) => app.paletteFor(role).map((page) => page.to);
  const barRoutes = (role) => app.mobileBarFor(role).map((item) => item.to);
  const createTargets = (role) => app.quickCreateFor(role).map(({ action }) => action.to);

  for (const [role, expected] of Object.entries(REACHES)) {
    it(`${role}: the sidebar and search offer exactly the same pages, the ones this role may open`, () => {
      assert.deepEqual(sidebarRoutes(role), expected);
      assert.deepEqual(paletteRoutes(role), expected);
    });

    it(`${role}: the phone bar and Create offer only things this role can open`, () => {
      const bar = barRoutes(role);
      assert.deepEqual(
        bar,
        app.MOBILE_BAR_ITEMS.map((item) => item.to).filter((to) => expected.includes(to)),
      );
      for (const to of bar) assert.ok(expected.includes(to), `${role}: bar offers ${to}`);
      for (const to of createTargets(role)) {
        assert.ok(app.canOpen(role, to), `${role}: Create offers ${to}, which it cannot open`);
      }
      // And it leaves out nothing it could have offered.
      assert.equal(
        createTargets(role).length,
        app.QUICK_CREATE_ACTIONS.filter((action) => app.canOpen(role, action.to)).length,
      );
    });
  }

  for (const role of UNKNOWN) {
    it(`an unknown or not-yet-loaded role (${JSON.stringify(role) ?? "undefined"}) is offered Home and nothing else`, () => {
      assert.deepEqual(sidebarRoutes(role), ["/dashboard"]);
      assert.deepEqual(paletteRoutes(role), ["/dashboard"]);
      assert.deepEqual(barRoutes(role), ["/dashboard"]);
      assert.deepEqual(createTargets(role), []);
      assert.deepEqual(app.searchableRecords(role), {
        contacts: false,
        products: false,
        articles: false,
      });
      assert.equal(app.canOpen(role, "/companies"), false);
      assert.equal(app.canOpen(role, "/inbox"), false);
    });
  }

  it("a role the rules do not know is not treated as Staff", () => {
    // It used to fall back to the Staff list, which opens the inbox and contacts.
    assert.deepEqual([...app.routesFor("some_new_role")], ["/dashboard"]);
  });

  it("the Create menu offers each role the right actions, by name", () => {
    const names = (role) => app.quickCreateFor(role).map(({ action }) => action.label);
    assert.deepEqual(names("seo_editor"), ["SEO article", "Content draft"]);
    assert.deepEqual(names("staff"), ["Contact", "Message", "Product"]);
    assert.deepEqual(names("marketing_manager"), [
      "Lead",
      "Contact",
      "Message",
      "Campaign",
      "Social post",
      "SEO article",
      "Content draft",
    ]);
    assert.equal(names("company_admin").length, app.QUICK_CREATE_ACTIONS.length);
    assert.deepEqual(names(undefined), []);
  });

  it("filtering Create keeps each action's own translation key", () => {
    for (const { action, index } of app.quickCreateFor("staff")) {
      assert.equal(app.QUICK_CREATE_ACTIONS[index], action);
      assert.equal(MESSAGES.en[`quickCreate.action.${index}.label`], action.label);
    }
  });

  it("an SEO editor is offered no Inbox and no Contacts, anywhere", () => {
    for (const surface of [sidebarRoutes, paletteRoutes, barRoutes, createTargets]) {
      const routes = surface("seo_editor");
      assert.ok(!routes.includes("/inbox"), "Inbox");
      assert.ok(!routes.includes("/contacts"), "Contacts");
    }
  });

  it("platform pages are for platform staff only, and only they can search for them", () => {
    for (const role of [...Object.keys(REACHES), ...UNKNOWN]) {
      const platformStaff = role === "super_admin";
      for (const to of PLATFORM) {
        assert.equal(app.canOpen(role, to), platformStaff, `${role} ${to}`);
        assert.equal(paletteRoutes(role).includes(to), platformStaff, `${role} search ${to}`);
        assert.equal(sidebarRoutes(role).includes(to), platformStaff, `${role} sidebar ${to}`);
      }
      const hasSection = app.navSectionsFor(role).some((section) => section.id === "platform");
      assert.equal(hasSection, platformStaff, `${role}: the Platform heading`);
    }
    // A company admin is not platform staff. Company admins see no Platform.
    assert.equal(app.canOpen("company_admin", "/companies/errors"), false);
    // A page nobody listed (a child of /companies) follows the same rule.
    assert.equal(app.canOpen("company_admin", "/companies/some-org-id"), false);
    assert.equal(app.canOpen("super_admin", "/companies/some-org-id"), true);
  });

  it("a child route follows its screen, and a path nobody knows is closed", () => {
    assert.equal(app.canOpen("seo_editor", "/seo-blog/studio"), true);
    assert.equal(app.canOpen("staff", "/seo-blog/studio"), false);
    assert.equal(app.canOpen("seo_editor", "/seo-blog/studio?x=1#top"), true);
    assert.equal(app.canOpen("company_admin", "/seo-blogger"), false, "a prefix is not a parent");
    assert.equal(app.canOpen("company_admin", "/nowhere"), false);
    assert.equal(app.canOpen("super_admin", "/nowhere"), false);
  });

  it("every other screen Create can open is one the rules know", () => {
    for (const action of app.QUICK_CREATE_ACTIONS) {
      assert.ok(app.canOpen("super_admin", action.to), `${action.to} is unknown to the rules`);
    }
  });

  it("does not give any role more than it had", () => {
    // The lists above are the rules as they stood; widening one would change them.
    const sorted = (list) => [...list].sort();
    assert.deepEqual(sorted(app.routesFor("staff")), sorted(REACHES.staff));
    assert.deepEqual(
      sorted(app.routesFor("seo_editor")),
      sorted([...REACHES.seo_editor, "/content"]),
    );
    assert.deepEqual(
      sorted(app.routesFor("marketing_manager")),
      sorted([...REACHES.marketing_manager, "/content"]),
    );
    assert.deepEqual(
      sorted(app.routesFor("company_admin")),
      sorted([...REACHES.company_admin, "/content"]),
    );
  });
});

describe("search asks the database only about records the role may open", () => {
  const fakeClient = () => {
    const asked = [];
    return {
      asked,
      from(table) {
        asked.push(table);
        const rows = [{ id: `${table}-1`, name: "Ada", title: "Ada", sku: null, status: "draft" }];
        const query = {
          select: () => query,
          or: () => query,
          ilike: () => query,
          limit: async () => ({ data: rows, error: null }),
        };
        return query;
      },
    };
  };
  const run = async (role, term = "ada") => {
    const client = fakeClient();
    const found = await app.searchRecords(client, term, role);
    return { asked: client.asked.sort(), found };
  };

  it("an SEO editor gets no customer or product results, and those queries are never sent", async () => {
    const { asked, found } = await run("seo_editor");
    assert.deepEqual(asked, ["seo_articles"]);
    assert.deepEqual(found.contacts, []);
    assert.deepEqual(found.products, []);
    assert.equal(found.articles.length, 1);
  });

  it("each role searches the records of the screens it can open", async () => {
    assert.deepEqual((await run("staff")).asked, ["contacts", "products"]);
    assert.deepEqual((await run("marketing_manager")).asked, ["contacts", "seo_articles"]);
    assert.deepEqual((await run("company_admin")).asked, ["contacts", "products", "seo_articles"]);
    assert.deepEqual((await run("super_admin")).asked, ["contacts", "products", "seo_articles"]);
  });

  it("an unknown or not-yet-loaded role searches nothing at all", async () => {
    for (const role of [undefined, null, "", "owner"]) {
      const { asked, found } = await run(role);
      assert.deepEqual(asked, [], String(role));
      assert.deepEqual(found, app.NO_RECORDS);
    }
  });

  it("a search that is too short sends nothing", async () => {
    assert.deepEqual((await run("company_admin", " a ")).asked, []);
  });

  it("the palette reads its records through that function and nowhere else", () => {
    const palette = read("src/components/CommandPalette.tsx");
    assert.equal(/\.from\(\s*"(contacts|products|seo_articles)"/.test(palette), false);
  });
});

// Review finding 4 on PR #70: a search that FAILED looked exactly like one that
// found nothing ("No matches found."), because the error was never read. A failed
// lookup is not "no results": it has to be told apart and said out loud.
describe("a search that could not run is not shown as 'no matches'", () => {
  const rowsFor = (table) => [
    { id: `${table}-1`, name: "Ada", title: "Ada", sku: null, status: "draft" },
  ];
  // `plan` says, per table, what that query does: "ok", "empty", "error", "throws" or "rejects".
  const clientWith = (plan) => ({
    from(table) {
      const how = plan[table] ?? "ok";
      const query = {
        select: () => query,
        or: () => query,
        ilike: () => query,
        limit: async () => {
          if (how === "rejects") throw new Error("network down");
          if (how === "error") return { data: null, error: { message: "permission denied" } };
          return { data: how === "empty" ? [] : rowsFor(table), error: null };
        },
      };
      if (how === "throws") throw new Error("client exploded");
      return query;
    },
  });
  const search = (plan, role = "company_admin") => app.searchRecords(clientWith(plan), "ada", role);

  it("a query that returns an error is reported as failed, not as empty", async () => {
    const found = await search({ contacts: "error" });
    assert.deepEqual(found.failed, ["contacts"]);
    assert.deepEqual(found.contacts, []);
  });

  it("an error is told apart from a real empty result", async () => {
    const empty = await search({ contacts: "empty", products: "empty", seo_articles: "empty" });
    assert.deepEqual(empty.failed, []);
    assert.deepEqual([empty.contacts, empty.products, empty.articles], [[], [], []]);
    const broken = await search({ contacts: "error", products: "error", seo_articles: "error" });
    assert.deepEqual(broken.failed, ["contacts", "products", "articles"]);
    assert.notDeepEqual(broken, empty);
  });

  it("a query that rejects or throws is failed too, and does not take the others down", async () => {
    for (const how of ["rejects", "throws"]) {
      const found = await search({ products: how });
      assert.deepEqual(found.failed, ["products"], how);
      assert.equal(found.contacts.length, 1, `${how}: contacts still shown`);
      assert.equal(found.articles.length, 1, `${how}: articles still shown`);
      assert.deepEqual(found.products, []);
    }
  });

  it("only kinds this role searches can fail, and the others are not counted", async () => {
    const found = await search({ contacts: "error", products: "error" }, "seo_editor");
    assert.deepEqual(found.failed, []);
    assert.equal(found.articles.length, 1);
    const articles = await search({ seo_articles: "error" }, "seo_editor");
    assert.deepEqual(articles.failed, ["articles"]);
  });

  it("nothing sent is not a failure", async () => {
    for (const role of [null, "owner"]) assert.deepEqual((await search({}, role)).failed, []);
    assert.deepEqual(app.NO_RECORDS.failed, []);
  });

  it("the hook's findRecords reports the same failure", async () => {
    globalThis.__tenantDouble = { staffRole: "staff", loading: false };
    let access;
    try {
      renderToStaticMarkup(
        createElement(() => {
          access = navHook.useNavAccess();
          return null;
        }),
      );
    } finally {
      delete globalThis.__tenantDouble;
    }
    const found = await access.findRecords(clientWith({ contacts: "error" }), "ada");
    assert.deepEqual(found.failed, ["contacts"]);
  });

  it("the palette says so, in one sentence, instead of 'No matches found'", () => {
    const palette = strip(read("src/components/CommandPalette.tsx"));
    // A rejected search must become a failed one, never an empty one.
    assert.equal(/\.catch\(\s*\(\)\s*=>\s*NO_RECORDS\s*\)/.test(palette), false);
    // Any failed kind, or a search that threw, marks the search as failed...
    assert.match(palette, /setSearchFailed\(answer === null \|\| answer\.failed\.length > 0\)/);
    // ...and a failed search shows the sentence INSTEAD of "No matches found".
    assert.match(
      palette,
      /\{searchFailed \? \(\s*<p role="alert"[^>]*>\s*\{t\("commandPalette\.searchFailed"\)\}\s*<\/p>\s*\) : \(\s*<CommandEmpty>/,
    );
  });

  it("the sentence exists in all five languages", () => {
    assert.equal(
      MESSAGES.en["commandPalette.searchFailed"],
      "Search could not load. Check your connection and try again.",
    );
    for (const language of LANGUAGES) {
      const text = MESSAGES[language]["commandPalette.searchFailed"];
      assert.ok(text && text.length > 10, language);
      assert.notEqual(text, MESSAGES[language]["commandPalette.noMatchesFound"], language);
    }
    for (const language of LANGUAGES.filter((code) => code !== "en")) {
      assert.notEqual(
        MESSAGES[language]["commandPalette.searchFailed"],
        MESSAGES.en["commandPalette.searchFailed"],
        `${language} is still English`,
      );
    }
  });
});

describe("the phone bar names every tab in a few letters", () => {
  const more = (language) => MESSAGES[language]["shell.more"];
  const barName = (language, item) =>
    item.barLabel
      ? MESSAGES[language][navMessageKey(item.to, "bar")]
      : MESSAGES[language][navMessageKey(item.to, "label")];
  // "ال" is the Arabic "the": "المنشورات" is the word "منشورات" with it on.
  const words = (text) =>
    text
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/^ال/, ""))
      .filter(Boolean);

  for (const language of LANGUAGES) {
    it(`${language}: every bar label, and More, fits a slot (at most 12 characters)`, () => {
      for (const item of app.MOBILE_BAR_ITEMS) {
        const name = barName(language, item);
        assert.ok(name && name.trim(), `${language}: ${item.to} has no bar name`);
        assert.ok([...name].length <= 12, `${language}: "${name}" is too long for the bar`);
      }
      assert.ok([...more(language)].length <= 12, `${language}: More`);
    });

    it(`${language}: a short bar name is a word from the full name, never a new word`, () => {
      for (const item of app.MOBILE_BAR_ITEMS) {
        if (!item.barLabel) continue;
        const short = words(barName(language, item));
        const full = words(MESSAGES[language][navMessageKey(item.to, "label")]);
        for (const word of short) {
          assert.ok(full.includes(word), `${language}: "${word}" is not in "${full.join(" ")}"`);
        }
      }
    });
  }

  it("only Social posts needs a short name; the other tabs already fit", () => {
    assert.deepEqual(
      app.MOBILE_BAR_ITEMS.filter((item) => item.barLabel).map((item) => [item.to, item.barLabel]),
      [["/social", "Posts"]],
    );
  });

  it("the bar's old private names are gone, not left unread", () => {
    for (const language of LANGUAGES) {
      for (const key of ["dashboard", "inbox", "marketing", "social"]) {
        assert.equal(
          `bottomNav.${key}` in MESSAGES[language],
          false,
          `${language} bottomNav.${key}`,
        );
      }
    }
  });
});

/* ───────── F5: Social posts can be found, and its tabs keep their place ───────── */

describe("the Social posts tab lives in the address", () => {
  const social = read("src/routes/_authenticated/social.tsx");

  it("knows exactly three tabs, the writer first", () => {
    assert.deepEqual([...app.SOCIAL_TABS], ["write", "comments", "reach"]);
    assert.equal(app.DEFAULT_SOCIAL_TAB, "write");
  });

  it("opens the writer for a missing, empty or unknown tab", () => {
    for (const value of [
      undefined,
      null,
      "",
      "bogus",
      "Write",
      " write",
      0,
      7,
      {},
      [],
      ["reach"],
    ]) {
      assert.equal(app.parseSocialTab(value), "write", JSON.stringify(value));
    }
    // The names the tabs had inside the page are not addresses.
    assert.equal(app.parseSocialTab("composer"), "write");
    assert.equal(app.parseSocialTab("inbox"), "write");
  });

  it("keeps the two other tabs directly linkable", () => {
    assert.equal(app.parseSocialTab("comments"), "comments");
    assert.equal(app.parseSocialTab("reach"), "reach");
    assert.equal(app.parseSocialTab("write"), "write");
  });

  it("the page reads its tab from the address and writes it back when it changes", () => {
    assert.ok(social.includes('parseSocialTab(search["tab"])'), "validateSearch checks the tab");
    assert.ok(social.includes("parseSocialTab(search.tab)"), "the page opens on that tab");
    assert.ok(
      social.includes("<Tabs value={tab} onValueChange={setTab}"),
      "the tabs are controlled",
    );
    assert.equal(
      /useState\("composer"\)|useState\("write"\)/.test(social),
      false,
      "no private tab state",
    );
    // Changing tab navigates (a new history entry, so Back returns to the last tab).
    const change = social.slice(
      social.indexOf("const setTab"),
      social.indexOf("const [editingPost"),
    );
    assert.ok(change.includes("navigate({ search:"), "setTab changes the address");
    assert.equal(change.includes("replace"), false, "Back must be able to return to the last tab");
  });

  it("the three tab triggers and their bodies use the address values", () => {
    for (const tab of ["write", "comments", "reach"]) {
      assert.ok(social.includes(`<TabsTrigger value="${tab}"`), `trigger ${tab}`);
      assert.ok(social.includes(`<TabsContent value="${tab}"`), `content ${tab}`);
    }
    assert.equal(social.includes('value="composer"'), false);
    assert.equal(social.includes('value="inbox"'), false);
  });

  it("editing a draft brings the person back to the writer", () => {
    const edit = social.slice(
      social.indexOf("const editPost"),
      social.indexOf("return (\n    <main"),
    );
    assert.ok(edit.includes('setTab("write")'));
  });

  it("dismissing a connection notice keeps the open tab", () => {
    assert.ok(social.includes("search: { tab }"));
  });

  it("still says on every tab that Flas does not publish", () => {
    const notice = social.indexOf("social.noPublishTitle");
    assert.ok(notice > 0, "the notice is on the page");
    assert.ok(
      notice < social.indexOf("<Tabs "),
      "and it is above the tabs, so it shows on all three",
    );
    assert.match(MESSAGES.en["social.noPublishBody"], /does not (send|publish|post)/i);
    assert.ok(!/automatic(ally)? (post|publish)/i.test(MESSAGES.en["social.noPublishBody"]));
  });
});

describe("every way into Social posts lands where its name says", () => {
  const create = app.QUICK_CREATE_ACTIONS.find((action) => action.label === "Social post");

  it('"+ Create → Social post" opens the writer', () => {
    assert.equal(create.to, "/social");
    assert.deepEqual(create.search, { tab: "write" });
    assert.equal(app.parseSocialTab(create.search.tab), "write");
    assert.ok(
      read("src/components/QuickCreate.tsx").includes("search: action.search"),
      "Create passes the tab on",
    );
  });

  it("the menu entry and the phone bar open the writer (the default)", () => {
    const entry = items.find((item) => item.to === "/social");
    assert.equal(entry.label, "Social posts");
    assert.equal(app.parseSocialTab(undefined), "write");
    assert.ok(app.mobileBarFor("company_admin").some((item) => item.to === "/social"));
  });

  it("every link that expected the comments view now asks for it by name", () => {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx$/.test(name)) files.push(path);
      }
    };
    walk(fileURLToPath(new URL("../src", import.meta.url)));
    let links = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8").split("\r\n").join("\n");
      for (const match of source.matchAll(/to="\/social"/g)) {
        links += 1;
        const after = source.slice(match.index, match.index + 80);
        assert.ok(
          after.includes('search={{ tab: "comments" }}'),
          `${file}: a /social link has no tab`,
        );
      }
    }
    assert.ok(links >= 3, `expected the dashboard and channel links, found ${links}`);
  });
});

/* ───────── Old menu names in other screens' text ───────── */

describe("no screen tells a person to open a menu entry that no longer exists", () => {
  // The names the menu had before 12 Oct, and what they are called now.
  const RETIRED =
    /\b(Social Hub|SEO Studio|Content & SEO|Leads & Marketing|Integrations|Monitoring)\b/;
  // Text owned by PR #54 (Antigravity), which is open on these screens. Mentions
  // there are not changed here; the PR lists them as "left for #54".
  const LEFT_FOR_54 = /^(sales|seoBlogStudio|invoice[A-Za-z]*)\./;
  // Where a retired word is not the name of a menu entry, case by case.
  const NOT_A_MENU_NAME = {
    "features.item.3.1.title":
      "public site: names the capability (monitoring and webhooks), points nowhere",
    "home.module.9.title":
      "public site: names the capability (monitoring and webhooks), points nowhere",
    "pricing.included.10": "public pricing list: names what is included, points nowhere",
    "integrationsV2.integrations": "title of IntegrationsV2, a component no route renders any more",
  };

  it("English text names no retired entry, except where it is not a menu name", () => {
    const found = Object.entries(MESSAGES.en)
      .filter(([key, text]) => !LEFT_FOR_54.test(key) && RETIRED.test(text))
      .map(([key, text]) => `${key}: ${text}`)
      .filter((line) => !(line.split(":")[0] in NOT_A_MENU_NAME));
    assert.deepEqual(found, []);
  });

  it("every allowance still matches a real sentence (none is left over)", () => {
    for (const key of Object.keys(NOT_A_MENU_NAME)) {
      assert.ok(RETIRED.test(MESSAGES.en[key] ?? ""), `${key} no longer needs an allowance`);
    }
  });

  // What the sentences that sent people to a retired entry say now, in every
  // language: the new name, not the old one.
  const POINTERS = {
    "campaignPlanner.noConnectedSocialAccountsYet": "social",
    "content.websiteIsTheFlasHosted": "connect",
    "dashboard.social.hub": "social",
    "dashboard.recent.none": "connect",
    "dashboard.meta.fullMonitoring": "monitoring",
    "home.step.0.body": "connect",
    "inbox.block.no_number": "connect",
    "inbox.block.number_missing": "connect",
    "inbox.block.number_disabled": "connect",
    "integrationsAuditFixed.integrations": "connect",
    "marketing.connectAWhatsappNumberIn": "connect",
    "settingsIndex.integrations": "connect",
    "socialInbox.connectASocialAccountIn": "social",
    "widgetDemo.integrationsWebsiteChatWidgetPreview": "connect",
    "wordPressSitesCard.connectWordpressForOneClick": "seo-blog",
  };
  const OLD_NAMES = {
    ar: ["مركز التواصل الاجتماعي", "استوديو SEO", "استوديو تحسين البحث", "التكاملات", "المراقبة"],
    ms: ["Hab Sosial", "Studio SEO", "Integrasi", "Pemantauan"],
    fil: ["Social Hub", "SEO Studio", "Mga Integrasyon", "Integrations hub", "Monitoring"],
    sw: ["Kitovu cha Mitandao", "Studio ya SEO", "Miunganisho", "kitovu"],
  };

  // Where the text is only the name itself (a link, a page title), it IS the menu's name.
  const IS_THE_NAME = {
    "dashboard.social.hub": "/social",
    "dashboard.meta.fullMonitoring": "/monitoring",
    "integrationsAuditFixed.integrations": "/connect",
    "settingsIndex.integrations": "/connect",
  };

  for (const language of LANGUAGES) {
    it(`${language}: each name-only text is the menu's name`, () => {
      for (const [key, route] of Object.entries(IS_THE_NAME)) {
        assert.equal(
          MESSAGES[language][key],
          MESSAGES[language][navMessageKey(route, "label")],
          key,
        );
      }
    });

    it(`${language}: each sentence that points at a menu entry uses the entry's current name`, () => {
      for (const key of Object.keys(POINTERS)) {
        const text = MESSAGES[language][key];
        assert.ok(text, `${language}: ${key} is missing`);
        for (const old of OLD_NAMES[language] ?? []) {
          assert.ok(!text.includes(old), `${language} ${key} still says "${old}": ${text}`);
        }
      }
    });
  }

  it("a sentence that names Connect accounts or Social posts spells it as the menu does", () => {
    for (const key of [
      "inbox.block.no_number",
      "marketing.connectAWhatsappNumberIn",
      "dashboard.recent.none",
    ]) {
      assert.ok(MESSAGES.en[key].includes(MESSAGES.en["nav.connect.label"]), key);
    }
    assert.ok(
      MESSAGES.en["socialInbox.connectASocialAccountIn"].includes(MESSAGES.en["nav.social.label"]),
    );
    assert.ok(
      MESSAGES.en["wordPressSitesCard.connectWordpressForOneClick"].includes(
        MESSAGES.en["nav.seo-blog.label"],
      ),
    );
  });

  it("the Connect accounts page is titled by its menu name", () => {
    const connect = read("src/routes/_authenticated/connect.tsx");
    const page = read("src/components/integrations-v2/IntegrationsAuditFixed.tsx");
    assert.ok(connect.includes("IntegrationsAuditFixed"));
    assert.ok(page.includes('t("integrationsAuditFixed.integrations")'));
    assert.equal(
      MESSAGES.en["integrationsAuditFixed.integrations"],
      MESSAGES.en["nav.connect.label"],
    );
  });

  it("the channel picker's link says Social posts, not Social Hub", () => {
    const picker = read("src/components/channels/ChannelPicker.tsx");
    assert.equal(picker.includes("Social Hub"), false);
    assert.ok(picker.includes("Go to Social posts"));
  });
});

describe("Swahili: the two grammar fixes on the Social posts notes", () => {
  it("Flas hailichapishi (the subject is Flas, and the verb is chapisha everywhere else)", () => {
    assert.match(MESSAGES.sw["social.noPublishBody"], /Flas hailichapishi kwa niaba yako/);
    assert.equal(MESSAGES.sw["social.noPublishBody"].includes("haliwasilishi"), false);
  });

  it("linakili (the button says Nakili chapisho; iga means imitate)", () => {
    assert.match(MESSAGES.sw["social.copyThenPost"], /kisha linakili na ulichapishe/);
    assert.equal(MESSAGES.sw["social.copyThenPost"].includes("liige"), false);
  });
});

/* ───────── F6: the old names are search words, never a second entry ───────── */

describe("the names the menu used to have still find the right page, and add no entry", () => {
  const OLD_NAMES = {
    "social hub": "/social",
    "seo studio": "/seo-blog",
    "content & seo": "/seo-blog",
    "saved drafts": "/seo-blog",
    integrations: "/connect",
    monitoring: "/monitoring",
    "leads & marketing": "/marketing",
  };
  const aliasesOf = (to) => items.find((item) => item.to === to).keywords.toLowerCase();

  for (const [name, to] of Object.entries(OLD_NAMES)) {
    it(`typing "${name}" finds ${to}`, () => {
      assert.ok(aliasesOf(to).includes(name), `${to} has no alias "${name}"`);
      // And search can really offer it: the page is in the palette for a role that reaches it.
      assert.ok(app.paletteFor("company_admin").some((page) => page.to === to));
    });
  }

  it("an old name is never a visible label, description or heading, in any language", () => {
    const retired =
      /Social Hub|SEO Studio|Content & SEO|Leads & Marketing|Integrations|Monitoring/i;
    for (const language of LANGUAGES) {
      for (const section of sections) {
        assert.ok(!retired.test(MESSAGES[language][`nav.section.${section.id}`]));
      }
      for (const item of items) {
        for (const part of ["label", "desc", "bar"]) {
          const text = MESSAGES[language][navMessageKey(item.to, part)];
          if (text) assert.ok(!retired.test(text), `${language} ${item.to} ${part}: ${text}`);
        }
      }
    }
  });

  it("there is one search result per screen, so an alias is not a second entry", () => {
    const palette = app.paletteFor("super_admin").map((page) => page.to);
    assert.equal(new Set(palette).size, palette.length);
    assert.ok(
      !palette.includes("/content"),
      "Saved drafts is reached from Website & SEO, not listed",
    );
    assert.deepEqual([...app.UNLISTED_ROUTES], ["/content"]);
  });

  it("Saved drafts keeps its address and is named the same everywhere it appears", () => {
    assert.equal(app.canOpen("seo_editor", "/content"), true);
    for (const language of LANGUAGES) {
      assert.equal(
        MESSAGES[language]["nav.content.label"],
        MESSAGES[language]["content.contentSeo"],
        `${language}: the Saved drafts name differs between nav and the screen`,
      );
    }
    assert.equal(MESSAGES.en["nav.content.label"], "Saved drafts");
  });
});

/* ───────── Platform email: the same entry PR #54 adds ───────── */

describe("Platform email is a platform-only entry, written as PR #54 writes it", () => {
  const entry = MANAGER_SECTION.items.find((item) => item.to === "/companies/email-settings");

  it("is under Platform, after Errors & issues, with the route-derived keys", () => {
    assert.ok(entry, "the entry is missing");
    assert.equal(entry.label, "Platform email");
    assert.equal(entry.desc, "System SMTP and IMAP settings");
    assert.equal(navMessageKey(entry.to, "label"), "nav.companies.email-settings.label");
    assert.deepEqual(
      MANAGER_SECTION.items.map((item) => item.to),
      ["/companies", "/companies/errors", "/companies/email-settings"],
    );
  });

  it("uses #54's Arabic, Malay, Filipino and Swahili, so the two PRs agree", () => {
    const theirs = {
      ar: ["بريد المنصة", "إعدادات SMTP وIMAP للنظام"],
      ms: ["E-mel Platform", "Tetapan SMTP dan IMAP sistem"],
      fil: ["Platform Email", "Mga setting ng SMTP at IMAP ng system"],
      sw: ["Barua Pepe ya Jukwaa", "Mipangilio ya SMTP na IMAP ya mfumo"],
    };
    for (const [language, [label, desc]] of Object.entries(theirs)) {
      assert.equal(MESSAGES[language]["nav.companies.email-settings.label"], label);
      assert.equal(MESSAGES[language]["nav.companies.email-settings.desc"], desc);
    }
  });

  it("is for platform staff only, and only they can search for it", () => {
    for (const role of ["company_admin", "marketing_manager", "staff", "seo_editor", undefined]) {
      assert.equal(app.canOpen(role, entry.to), false, String(role));
      assert.ok(!app.paletteFor(role).some((page) => page.to === entry.to));
    }
    assert.ok(app.paletteFor("super_admin").some((page) => page.to === entry.to));
    assert.ok(
      app.navSectionsFor("super_admin").some((s) => s.items.some((i) => i.to === entry.to)),
    );
  });

  it("is a page the app serves", () => {
    assert.ok(read("src/routeTree.gen.ts").includes("'/companies/email-settings':"));
  });
});

describe("text written straight into screens does not send anyone to a retired entry", () => {
  // Screens whose English is in the code, not in the five-language files. Files
  // owned by PR #54 (seo-blog.studio.tsx, sales, inbox, ...) are not checked here.
  const FILES = [
    "src/lib/connection-setup.ts",
    "src/lib/connection-state.ts",
    "src/components/channels/SocialConnectionWizard.tsx",
    "src/components/channels/ChannelPicker.tsx",
    "src/routes/_authenticated/campaign-planner.tsx",
    "src/routes/_authenticated/connect.tsx",
    "src/routes/_authenticated/marketing.tsx",
    "src/routes/index.tsx",
    // Install text a customer reads inside the downloaded plugin packages.
    "src/lib/shopify-plugin.server.ts",
    "src/lib/wordpress-plugin.server.ts",
  ];
  const RETIRED = /\b(Social Hub|SEO Studio|Content & SEO|Leads & Marketing|Integrations)\b/;
  // "Monitoring & webhooks" is the name of a capability on the public home page, not a menu entry.
  const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

  for (const file of FILES) {
    it(`${file} names no retired entry`, () => {
      const lines = read(file).split("\n");
      const bad = lines.filter((line) => !isComment(line) && RETIRED.test(line));
      assert.deepEqual(bad, []);
    });
  }

  it("the browser-tab titles match the menu", () => {
    assert.ok(
      read("src/routes/_authenticated/connect.tsx").includes("Connect accounts — Flas CRM"),
    );
    assert.ok(read("src/routes/_authenticated/marketing.tsx").includes("Leads & email — Flas CRM"));
  });

  it("the Leads & email page is headed with the menu's own label, in the reader's language", () => {
    const page = strip(read("src/routes/_authenticated/marketing.tsx"));
    // Not the old name in any spelling...
    assert.equal(/Leads\s*(&|&amp;)\s*marketing/i.test(page), false);
    // ...but the label the menu shows for this screen, from the same translation key.
    assert.match(
      page,
      /<h1[^>]*>\s*\{tx\(navMessageKey\("\/marketing", "label"\), "Leads & email"\)\}\s*<\/h1>/,
    );
    assert.equal(MESSAGES.en[navMessageKey("/marketing", "label")], "Leads & email");
    for (const language of LANGUAGES) {
      assert.ok(MESSAGES[language][navMessageKey("/marketing", "label")], language);
    }
  });
});
