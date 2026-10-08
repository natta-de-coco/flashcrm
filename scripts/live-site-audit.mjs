// Live site comprehensive audit script for https://flas.mobidigisol.com/
import https from "node:https";

const BASE_URL = "https://flas.mobidigisol.com";

const ROUTES = [
  "/",
  "/auth",
  "/features",
  "/pricing",
  "/blog",
  "/whatsapp-business-api",
  "/terms",
  "/privacy",
  "/sitemap.xml",
  "/robots.txt",
];

async function fetchRoute(path) {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const duration = Date.now() - start;
        resolve({
          path,
          status: res.statusCode,
          headers: res.headers,
          duration,
          body: data,
        });
      });
    }).on("error", (err) => {
      resolve({
        path,
        error: err.message,
        duration: Date.now() - start,
      });
    });
  });
}

async function runAudit() {
  console.log(`Starting live site audit against ${BASE_URL}...\n`);
  const results = [];

  for (const path of ROUTES) {
    const res = await fetchRoute(path);
    results.push(res);
    if (res.error) {
      console.log(`❌ [${res.path}] Error: ${res.error}`);
      continue;
    }

    const hasH1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.test(res.body);
    const titleMatch = res.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "NONE";
    const descMatch = res.body.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
    const desc = descMatch ? descMatch[1] : "NONE";
    const hasCanonical = /<link[^>]*rel=["']canonical["']/i.test(res.body);
    const hasLang = /<html[^>]*lang=["']([^"']*)["']/i.test(res.body);
    const hasDir = /<html[^>]*dir=["']([^"']*)["']/i.test(res.body);

    console.log(`✅ [${res.status}] ${res.path} (${res.duration}ms)`);
    console.log(`   Title: ${title}`);
    console.log(`   Has H1: ${hasH1} | Canonical: ${hasCanonical} | Lang: ${hasLang} | Dir: ${hasDir}`);
    console.log(`   Description length: ${desc.length} chars`);
    
    // Check security headers
    const secHeaders = {
      "strict-transport-security": !!res.headers["strict-transport-security"],
      "x-content-type-options": !!res.headers["x-content-type-options"],
      "x-frame-options": !!res.headers["x-frame-options"],
      "referrer-policy": !!res.headers["referrer-policy"],
    };
    console.log(`   Security headers:`, secHeaders);
    console.log("");
  }

  // Detailed analysis of landing page
  const home = results.find((r) => r.path === "/");
  if (home && home.body) {
    console.log("=== LANDING PAGE UX/UI CHECKS ===");
    // Language switcher presence
    const hasLangSwitcher = /Change language|aria-label=["']Change language["']/i.test(home.body);
    console.log(`• Language switcher present in header: ${hasLangSwitcher}`);

    // CTA buttons
    const hasCta = /Start free for one month|Request a quotation|Open app/i.test(home.body);
    console.log(`• Primary & secondary CTAs present: ${hasCta}`);

    // Brand name check (Flas vs Flash)
    const flashCount = (home.body.match(/Flash/g) || []).length;
    const flasCount = (home.body.match(/Flas/g) || []).length;
    console.log(`• Branding occurrences: "Flas": ${flasCount}, "Flash": ${flashCount}`);

    // Pricing accuracy ($20/month, 1 month free)
    const mentionsPricing = /\$20\/month|\$240 a year|one month free/i.test(home.body);
    console.log(`• Accurate promotional pricing mentioned: ${mentionsPricing}`);

    // Broken image links or missing alt attributes
    const imgMatches = [...home.body.matchAll(/<img([^>]*)>/gi)];
    let imgsWithoutAlt = 0;
    for (const match of imgMatches) {
      if (!/alt=["'][^"']*["']/i.test(match[1])) {
        imgsWithoutAlt++;
      }
    }
    console.log(`• Total images: ${imgMatches.length}, Images without alt: ${imgsWithoutAlt}`);
  }
}

runAudit();
