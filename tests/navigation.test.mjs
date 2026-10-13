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

  it("every search, bar and Create surface reads its role from the one shared rule", () => {
    const bar = read("src/components/MobileBottomNav.tsx");
    const palette = read("src/components/CommandPalette.tsx");
    const create = read("src/components/QuickCreate.tsx");
    assert.ok(bar.includes("mobileBarFor("), "the bar filters by role");
    assert.ok(palette.includes("paletteFor("), "search filters its pages by role");
    assert.ok(palette.includes("searchRecords("), "search asks only for allowed records");
    assert.ok(create.includes("quickCreateFor("), "Create filters by role");
    for (const source of [bar, palette, create]) {
      assert.ok(source.includes("useNavAccess"), "the role comes from one hook");
    }
  });

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
    assert.ok(bar.includes("mobileBarFor"), "the bar builds its tabs from the menu");
    assert.ok(bar.includes("navMessageKey"), "the bar names its tabs with the menu's keys");
    assert.equal(bar.includes("bottomNav."), false, "the bar must not keep names of its own");

    const palette = read("src/components/CommandPalette.tsx");
    assert.ok(palette.includes("paletteFor"), "the palette builds its pages from the menu");
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
    assert.ok(menu.includes("navSectionsFor("), "the sidebar asks the shared rule");
    assert.equal(menu.includes("isSuperAdmin"), false, "no second, separate platform check");
  });
});

describe("the Create menu opens the same screens", () => {
  const actions = app.QUICK_CREATE_ACTIONS;
  const tree = read("src/routeTree.gen.ts");
  const served = (to) => tree.includes(`'${to}':`) || tree.includes(`'${to}/':`);

  it("is built from one list that the component reads", () => {
    assert.ok(Array.isArray(actions), "QUICK_CREATE_ACTIONS is missing");
    assert.ok(read("src/components/QuickCreate.tsx").includes("quickCreateFor"));
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
    ],
    staff: ["/dashboard", "/inbox", "/contacts", "/sales", "/catalog"],
    seo_editor: ["/dashboard", "/seo-blog"],
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
