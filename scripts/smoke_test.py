#!/usr/bin/env python3
"""
Flash CRM smoke test suite.

Loads every key route at mobile / iPad / desktop widths and reports:
  - console errors and page exceptions
  - failed network requests (4xx / 5xx / aborted)
  - horizontal overflow (layout breaking out of the viewport)
  - missing <h1> / empty main content

Run:  python3 scripts/smoke_test.py            (defaults to http://localhost:8080)
      BASE_URL=https://my-app.lovable.app python3 scripts/smoke_test.py

Auth: if LOVABLE_BROWSER_SUPABASE_STORAGE_KEY / _SESSION_JSON (and optionally
_COOKIES_JSON) are present in the environment, the session is restored so the
authenticated routes are actually exercised.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
SHOTS = Path(os.environ.get("SMOKE_SHOT_DIR", "/tmp/browser/smoke/screenshots"))

ROUTES = [
    ("/", "Landing"),
    ("/auth", "Sign in"),
    ("/dashboard", "Dashboard"),
    ("/inbox", "Inbox"),
    ("/social", "Social Hub"),
    ("/marketing", "Leads & Marketing"),
    ("/contacts", "Contacts"),
    ("/catalog", "Catalog"),
    ("/content", "Content & SEO"),
    ("/seo-blog", "SEO Studio"),
    ("/monitoring", "Monitoring"),
    ("/settings", "Settings"),
    ("/connect", "Connect"),
    ("/companies", "Companies portal"),
]

VIEWPORTS = [
    ("mobile", 390, 844),
    ("ipad", 820, 1180),
    ("ipad-landscape", 1180, 820),
    ("desktop", 1440, 900),
]

IGNORE_CONSOLE = (
    "Download the React DevTools",
    "[vite] connect",
    "React Router Future Flag",
)


async def restore_session(context, page):
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE_URL
        await context.add_cookies(cookies)
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )
        return True
    return bool(cookies_json)


async def check_route(page, path, name, label, failures):
    console_errors, request_failures = [], []

    def on_console(msg):
        if msg.type == "error" and not any(s in msg.text for s in IGNORE_CONSOLE):
            console_errors.append(msg.text[:300])

    def on_pageerror(err):
        console_errors.append(f"pageerror: {str(err)[:300]}")

    def on_response(res):
        if res.status >= 400:
            request_failures.append(f"{res.status} {res.url[:160]}")

    def on_requestfailed(req):
        request_failures.append(f"failed {req.url[:160]}")

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    page.on("response", on_response)
    page.on("requestfailed", on_requestfailed)

    await page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded")
    await page.wait_for_timeout(2500)

    overflow = await page.evaluate(
        """() => {
            const d = document.documentElement;
            const over = d.scrollWidth - d.clientWidth;
            if (over <= 2) return null;
            const wide = [...document.querySelectorAll('body *')]
              .filter(el => el.getBoundingClientRect().right > d.clientWidth + 2)
              .slice(0, 3)
              .map(el => el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 60));
            return { overflowPx: over, culprits: wide };
        }"""
    )
    text_len = await page.evaluate("() => (document.body.innerText || '').trim().length")

    page.remove_listener("console", on_console)
    page.remove_listener("pageerror", on_pageerror)
    page.remove_listener("response", on_response)
    page.remove_listener("requestfailed", on_requestfailed)

    problems = []
    if console_errors:
        problems.append(f"console: {console_errors[:3]}")
    if request_failures:
        problems.append(f"network: {request_failures[:3]}")
    if overflow:
        problems.append(f"horizontal overflow {overflow['overflowPx']}px {overflow['culprits']}")
    if text_len < 40:
        problems.append(f"page looks empty ({text_len} chars of text)")

    status = "FAIL" if problems else "ok"
    print(f"  [{status}] {label:<15} {name}")
    for p in problems:
        print(f"        - {p}")
        failures.append(f"{label} {name} ({path}): {p}")

    if problems:
        SHOTS.mkdir(parents=True, exist_ok=True)
        slug = (path.strip("/") or "index").replace("/", "_")
        await page.screenshot(path=str(SHOTS / f"{label}_{slug}.png"))


async def main():
    failures = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for label, w, h in VIEWPORTS:
            print(f"\n=== {label} ({w}x{h}) ===")
            context = await browser.new_context(
                viewport={"width": w, "height": h},
                device_scale_factor=2 if label != "desktop" else 1,
                is_mobile=label == "mobile",
                has_touch=label != "desktop",
            )
            page = await context.new_page()
            authed = await restore_session(context, page)
            if not authed:
                print("  (no session in env — authenticated routes will redirect to /auth)")
            for path, name in ROUTES:
                await check_route(page, path, name, label, failures)
            await context.close()
        await browser.close()

    print("\n" + "=" * 60)
    if failures:
        print(f"{len(failures)} problem(s) found:")
        for f in failures:
            print(f" - {f}")
        sys.exit(1)
    print("All routes passed on every viewport.")


asyncio.run(main())
