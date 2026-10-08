import { build } from "esbuild";
await build({
  stdin: {
    contents: `
      export * from './src/lib/invoice-pdf.server';
      export * from './src/lib/invoice-logo.server';
      export * from './src/lib/invoice-templates';
      export * from './src/lib/blog-templates';
      export * from './src/lib/accounting-sync';
      export * from './src/lib/seo-url';
    `,
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-invoices.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
});
