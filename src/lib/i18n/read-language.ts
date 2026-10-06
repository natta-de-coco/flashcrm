// The interface language for this request: on the server from the Cookie
// header, so the first paint is already in the right language and direction;
// in the browser from document.cookie, on every navigation.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { languageFromCookieHeader } from "@/lib/i18n";

export const readUiLanguage = createIsomorphicFn()
  .server(() => {
    try {
      return languageFromCookieHeader(getRequest()?.headers.get("cookie"));
    } catch {
      // Outside a request (a prerender): English.
      return languageFromCookieHeader(null);
    }
  })
  .client(() => languageFromCookieHeader(document.cookie));
