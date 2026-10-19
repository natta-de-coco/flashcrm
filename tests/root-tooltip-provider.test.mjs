import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ts from "typescript";

// Keep the real Radix components: mocking Tooltip used to hide the live crash.
buildSync({
  entryPoints: ["src/components/ui/tooltip.tsx"],
  outfile: "node_modules/.cache/flas-root-tooltip.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  jsx: "automatic",
  logLevel: "error",
});
const { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } =
  await import("../node_modules/.cache/flas-root-tooltip.mjs");
const source = readFileSync("src/routes/__root.tsx", "utf8");
const parsed = ts.createSourceFile(
  "root.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const root = parsed.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "RootComponent",
);
assert.ok(root, "Render the production root, not a second test-only provider tree");

function Outlet() {
  return React.createElement(
    Tooltip,
    null,
    React.createElement(TooltipTrigger, null, "Campaign planning help"),
    React.createElement(TooltipContent, null, "Drafts do not send automatically"),
  );
}
const passthrough = ({ children }) => children;

function renderRoot(inApp, omitProvider = false) {
  const productionFunction = omitProvider
    ? root.getText(parsed).replace(/<\/?TooltipProvider>/g, "")
    : root.getText(parsed);
  const compiled = ts.transpileModule(productionFunction, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const bindings = {
    React,
    QueryClientProvider,
    Route: { useRouteContext: () => ({ queryClient: new QueryClient(), uiLanguage: "en" }) },
    useRouterState: () => ({ pathname: inApp ? "/marketing" : "/", inApp }),
    useEffect: React.useEffect,
    I18nProvider: passthrough,
    AppearanceProvider: passthrough,
    AuthProvider: passthrough,
    PageLanguage: passthrough,
    TooltipProvider,
    Outlet,
    Toaster: () => null,
    isRtlUiLanguage: () => false,
  };
  const Component = new Function(...Object.keys(bindings), `${compiled}\nreturn RootComponent;`)(
    ...Object.values(bindings),
  );
  return renderToStaticMarkup(React.createElement(Component));
}

test("authenticated routes can render real tooltip controls without losing the app shell", () => {
  assert.match(renderRoot(true), /Campaign planning help/);
});

test("public routes share the same tooltip context", () => {
  assert.match(renderRoot(false), /Campaign planning help/);
});

test("removing the production provider reproduces the live Radix context error", () => {
  assert.throws(() => renderRoot(true, true), /Tooltip.*TooltipProvider/);
});
