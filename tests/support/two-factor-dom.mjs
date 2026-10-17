// A browser for the two-factor screens suite: jsdom's window and document put
// where the app's own code looks for them, so the real sign-in page, the real
// signed-in layout and the real auth provider can be drawn and clicked in a
// test. jsdom is already installed (it comes with isomorphic-dompurify).
//
// Call installBrowser() BEFORE the screens bundle is imported: supabase-js and
// React read these globals when they load.
import { JSDOM } from "jsdom";

export function installBrowser({ url = "https://app.test/auth" } = {}) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url,
    pretendToBeVisual: true,
  });
  const w = dom.window;

  // `navigator` is a read-only getter on Node's global, so plain assignment fails.
  const put = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  for (const name of [
    "document",
    "localStorage",
    "sessionStorage",
    "HTMLElement",
    "HTMLInputElement",
    "Node",
    "Event",
    "CustomEvent",
    "MutationObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    put(name, w[name]);
  }
  put("window", w);
  put("navigator", w.navigator);
  put("location", w.location);

  // Things jsdom does not have and the page's components ask for.
  const matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  w.matchMedia = matchMedia;
  put("matchMedia", matchMedia);
  put(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  // jsdom has no BroadcastChannel, but Node does, and supabase-js opens one in
  // anything that looks like a browser; an open channel keeps the test process
  // from ever exiting. Tabs are not simulated through it.
  put(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    },
  );

  // React's test mode: state changes made inside act() are flushed before it returns.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // The app's code is bundled with `window.location` pointed here (jsdom does
  // not let a test watch or replace the real one). `assigned` is every address
  // the page sent the whole browser to.
  const place = new URL(url);
  globalThis.__flasTestLocation = {
    pathname: place.pathname,
    search: place.search,
    hash: place.hash,
    href: place.href,
    origin: place.origin,
    assigned: [],
    assign(address) {
      this.assigned.push(String(address));
    },
  };

  return {
    window: w,
    document: w.document,
    root: w.document.getElementById("root"),
    location: globalThis.__flasTestLocation,
    close: () => w.close(),
  };
}
