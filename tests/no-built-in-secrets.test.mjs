// This repository is public. A key that has a fallback written in the source
// ("use the setting, or else this text") is a key anyone can read: if the
// setting is ever missing in production, the published text becomes the key.
// The unsubscribe link was signed that way until it was removed. This test
// fails on any file in src/ that puts a text value behind a secret, key, token
// or password setting, so the pattern cannot come back unnoticed.
//
// It reads each file with the TypeScript compiler instead of matching text line by line, because
// the formatter this repo uses moves a long fallback onto the next line, and a line-by-line
// pattern then sees nothing. It follows the setting through the shapes people actually write:
// `||`, `??`, `||=`, `??=`, a conditional, a default in a destructuring, a copy of
// `process.env` in a variable, `import.meta.env`, `Deno.env.get`, and a named constant that
// holds the text. It does not follow a value built by running code (a function's result).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import prettier from "prettier";
import ts from "typescript";

// The setting's name says it is a secret.
const SECRET_NAME = /SECRET|KEY|TOKEN|PASSWORD/i;

const unwrap = (node) => {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
};

const textOf = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

/** Line numbers (1-based) in `text` where a secret setting has a written-in text value behind it. */
function findFallbacks(text, fileName = "file.ts") {
  const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);

  const isProcessEnv = (node) =>
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "env" &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process";
  const isImportMetaEnv = (node) =>
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "env" &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;

  // First pass: names that hold the environment object, and names that hold a text constant.
  const envAliases = new Set();
  const constants = new Map();
  const isEnvObject = (node) => {
    const inner = unwrap(node);
    return Boolean(
      inner &&
      (isProcessEnv(inner) ||
        isImportMetaEnv(inner) ||
        (ts.isIdentifier(inner) && envAliases.has(inner.text))),
    );
  };
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isIdentifier(node.name)) {
        if (isEnvObject(init)) envAliases.add(node.name.text);
        const value = textOf(init);
        if (value) constants.set(node.name.text, value);
      } else if (
        ts.isObjectBindingPattern(node.name) &&
        ts.isIdentifier(init) &&
        init.text === "process"
      ) {
        // const { env } = process;
        for (const element of node.name.elements) {
          const from = element.propertyName ?? element.name;
          if (ts.isIdentifier(from) && from.text === "env" && ts.isIdentifier(element.name)) {
            envAliases.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  /** The setting this expression reads, if it reads one. */
  const settingName = (node) => {
    const inner = unwrap(node);
    if (!inner) return undefined;
    if (ts.isPropertyAccessExpression(inner) && isEnvObject(inner.expression)) {
      return inner.name.text;
    }
    if (ts.isElementAccessExpression(inner) && isEnvObject(inner.expression)) {
      return textOf(unwrap(inner.argumentExpression));
    }
    if (
      ts.isCallExpression(inner) &&
      ts.isPropertyAccessExpression(inner.expression) &&
      inner.expression.name.text === "get" &&
      ts.isPropertyAccessExpression(inner.expression.expression) &&
      inner.expression.expression.name.text === "env" &&
      ts.isIdentifier(inner.expression.expression.expression) &&
      inner.expression.expression.expression.text === "Deno"
    ) {
      return textOf(unwrap(inner.arguments[0]));
    }
    return undefined;
  };
  const isSecretRead = (node) => SECRET_NAME.test(settingName(node) ?? "");
  const containsSecretRead = (node) => {
    let found = false;
    const walk = (child) => {
      if (found) return;
      if (isSecretRead(child)) found = true;
      else ts.forEachChild(child, walk);
    };
    walk(node);
    return found;
  };

  /** A non-empty text written in the source, directly or through a named constant. */
  const isWrittenText = (node) => {
    const inner = unwrap(node);
    if (!inner) return false;
    if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
      return inner.text.length > 0;
    }
    if (ts.isTemplateExpression(inner)) return true;
    if (ts.isIdentifier(inner)) return Boolean(constants.get(inner.text));
    if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return isWrittenText(inner.left) || isWrittenText(inner.right);
    }
    if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)) {
      return isWrittenText(inner.expression.expression); // "text".trim(), "text".repeat(2)
    }
    return false;
  };

  const FALLBACK_OPERATORS = [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken];
  /** `a || b ?? c ...` as the list [a, b, c]. */
  const operands = (node) => {
    const inner = unwrap(node);
    if (
      inner &&
      ts.isBinaryExpression(inner) &&
      FALLBACK_OPERATORS.includes(inner.operatorToken.kind)
    ) {
      return [...operands(inner.left), ...operands(inner.right)];
    }
    return [inner];
  };

  const lines = new Set();
  const report = (node) => {
    lines.add(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
  };

  const visit = (node) => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (FALLBACK_OPERATORS.includes(op)) {
        const list = operands(node);
        const firstRead = list.findIndex((operand) => isSecretRead(operand));
        if (firstRead !== -1 && list.slice(firstRead + 1).some(isWrittenText)) report(node);
      } else if (
        (op === ts.SyntaxKind.BarBarEqualsToken ||
          op === ts.SyntaxKind.QuestionQuestionEqualsToken) &&
        isSecretRead(node.left) &&
        isWrittenText(node.right)
      ) {
        report(node);
      } else if (op === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(node.left)) {
        // ({ NAME = "text" } = process.env);
        if (isEnvObject(node.right)) {
          for (const property of node.left.properties) {
            if (
              ts.isShorthandPropertyAssignment(property) &&
              SECRET_NAME.test(property.name.text) &&
              property.objectAssignmentInitializer &&
              isWrittenText(property.objectAssignmentInitializer)
            ) {
              report(property);
            } else if (
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              SECRET_NAME.test(property.name.text) &&
              ts.isBinaryExpression(property.initializer) &&
              property.initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              isWrittenText(property.initializer.right)
            ) {
              // { NAME: alias = "text" }
              report(property);
            }
          }
        }
      }
    } else if (ts.isConditionalExpression(node)) {
      // process.env.X_KEY ? process.env.X_KEY : "text", or the other way round
      const branches = [...operands(node.whenTrue), ...operands(node.whenFalse)];
      if (
        branches.some(isWrittenText) &&
        (containsSecretRead(node.condition) || branches.some((b) => containsSecretRead(b)))
      ) {
        report(node);
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isEnvObject(node.initializer)
    ) {
      // const { NAME = "text", OTHER: alias = "text" } = process.env;
      for (const element of node.name.elements) {
        const from = element.propertyName ?? element.name;
        if (
          ts.isIdentifier(from) &&
          SECRET_NAME.test(from.text) &&
          element.initializer &&
          isWrittenText(element.initializer)
        ) {
          report(element);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return [...lines].sort((a, b) => a - b);
}

const srcRoot = new URL("../src/", import.meta.url);

function sourceFiles(dir = "") {
  const out = [];
  for (const entry of readdirSync(new URL(dir, srcRoot), { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(`${path}/`));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

// A stand-in value that is clearly not a key. Fixtures never hold a real or former key value.
const LONG = "placeholder-text-that-is-long-enough-to-make-the-formatter-break-the-line-".repeat(2);

/** Shapes that must be caught: the first four are what the old line-by-line pattern caught. */
const BAD = {
  "one line, ||": 'const k = process.env["APP_SIGNING_SECRET"] || "placeholder-value";',
  "one line, ?? with single quotes": "const k = process.env.API_KEY ?? 'placeholder-value';",
  "template text": "const k = process.env['SOME_TOKEN'] || `placeholder-value`;",
  "short text": 'const k = process.env.DB_PASSWORD || "x";',
  "inside a call": 'const k = (process.env.API_KEY || "placeholder-value").trim();',
  "as the formatter lays out a long line": `const k =\n  process.env["APP_SIGNING_SECRET"] ||\n  "${LONG}";`,
  "formatted ??": `const k =\n  process.env.APP_SIGNING_SECRET ??\n  "${LONG}";`,
  "the text on a line of its own":
    'const k = process.env.APP_SIGNING_SECRET ||\n\n  // fallback\n  "placeholder-value";',
  "||=": 'process.env.APP_SIGNING_SECRET ||= "placeholder-value";',
  "??=": 'process.env["APP_SIGNING_SECRET"] ??= "placeholder-value";',
  "a default in a destructuring":
    'const { APP_SIGNING_SECRET = "placeholder-value" } = process.env;',
  "a renamed default in a destructuring":
    'const { APP_SIGNING_SECRET: secret = "placeholder-value" } = process.env;',
  "a default in an assignment destructuring":
    'let s; ({ APP_SIGNING_SECRET: s = "placeholder-value" } = process.env);',
  "a named constant":
    'const DEFAULT_KEY = "placeholder-value";\nconst k = process.env.API_KEY || DEFAULT_KEY;',
  "a named constant, other order":
    'const k = process.env.API_KEY ?? DEFAULT_VALUE;\nconst DEFAULT_VALUE = "placeholder-value";',
  "import.meta.env": 'const k = import.meta.env.VITE_APP_KEY || "placeholder-value";',
  "import.meta.env, bracket": 'const k = import.meta.env["VITE_APP_TOKEN"] ?? "placeholder-value";',
  "Deno.env.get": 'const k = Deno.env.get("APP_SIGNING_SECRET") || "placeholder-value";',
  "a conditional":
    'const k = process.env.APP_SIGNING_SECRET ? process.env.APP_SIGNING_SECRET : "placeholder-value";',
  "a conditional the other way":
    'const k = !process.env.APP_SIGNING_SECRET ? "placeholder-value" : process.env.APP_SIGNING_SECRET;',
  "a copy of process.env":
    'const e = process.env;\nconst k = e.APP_SIGNING_SECRET || "placeholder-value";',
  "a copy of process.env, destructured default":
    'const e = process.env;\nconst { APP_SIGNING_SECRET = "placeholder-value" } = e;',
  "env taken out of process":
    'const { env } = process;\nconst k = env.APP_SIGNING_SECRET || "placeholder-value";',
  "a chain that ends in text":
    'const k = process.env.A_SECRET || process.env.B_SECRET || "placeholder-value";',
  "text joined on": 'const k = process.env.A_SECRET || "placeholder-" + "value";',
  "a typed read": 'const k = (process.env.A_SECRET as string) || "placeholder-value";',
  "a non-null read": 'const k = process.env.A_SECRET! ?? "placeholder-value";',
  "tsx file": {
    file: "x.tsx",
    code: 'const k = <div>{process.env.A_SECRET || "placeholder-value"}</div>;',
  },
};

/** Shapes that are allowed. */
const FINE = {
  "a setting that is not a secret":
    'const url = process.env["PUBLIC_APP_URL"] || "https://example.com";',
  "an empty fallback": 'const k = process.env["APP_SIGNING_SECRET"] ?? "";',
  "an empty fallback, trimmed": 'const k = (process.env.API_KEY || "").trim();',
  "no fallback": 'const k = process.env["APP_SIGNING_SECRET"];',
  "another setting as the fallback": "const k = process.env.API_KEY ?? process.env.OTHER_KEY;",
  "a setting that is not a secret, formatted": `const url =\n  process.env.PUBLIC_APP_URL ||\n  "${LONG}";`,
  "a destructuring without a default": "const { APP_SIGNING_SECRET } = process.env;",
  "a destructuring with an empty default": 'const { APP_SIGNING_SECRET = "" } = process.env;',
  "a destructuring default for a setting that is not a secret":
    'const { PUBLIC_APP_URL = "https://example.com" } = process.env;',
  "a conditional on something else":
    'const mode = process.env.NODE_ENV === "production" ? "a" : "b";',
  "text beside a secret, not behind it": 'const name = "api-key"; const k = process.env.API_KEY;',
  "text in front of the setting": 'const k = "placeholder-value" || process.env.API_KEY;',
  "a constant that is not text": "const LIMIT = 5;\nconst k = process.env.API_KEY || LIMIT;",
  "import.meta.env that is not a secret":
    'const u = import.meta.env.VITE_SUPABASE_URL || "https://example.com";',
  "a copy of something else":
    'const e = { API_KEY: "x" };\nconst k = e.API_KEY || "placeholder-value";',
};

const caseOf = (value) => (typeof value === "string" ? { file: "file.ts", code: value } : value);

describe("no key has a built-in fallback value", () => {
  it("recognises every shape it is meant to catch", () => {
    for (const [name, value] of Object.entries(BAD)) {
      const { file, code } = caseOf(value);
      assert.notDeepEqual(findFallbacks(code, file), [], `should be caught: ${name}`);
    }
  });

  it("leaves alone what is allowed", () => {
    for (const [name, value] of Object.entries(FINE)) {
      const { file, code } = caseOf(value);
      assert.deepEqual(findFallbacks(code, file), [], `should be allowed: ${name}`);
    }
  });

  it("reports the line where the setting is read", () => {
    const code = `const a = 1;\nconst b = 2;\nconst k =\n  process.env.APP_SIGNING_SECRET ||\n  "${LONG}";\n`;
    assert.deepEqual(findFallbacks(code), [4]);
  });

  it("still catches the shape after the repo's own formatter has rewritten it", async () => {
    const written = `const k = process.env["APP_SIGNING_SECRET"] || "${LONG}";`;
    const formatted = await prettier.format(written, { parser: "typescript", printWidth: 100 });

    assert.ok(formatted.includes("||\n"), "the formatter moved the text to its own line");
    assert.notDeepEqual(findFallbacks(formatted), []);
    // The line-by-line pattern this test used to rely on would have missed it.
    const oldPattern =
      /process\.env(?:\.|\[\s*["'`])\w*(?:SECRET|KEY|TOKEN|PASSWORD)\w*["'`]?\s*\]?\s*(?:\|\||\?\?)\s*(["'`])(?!\1)/i;
    assert.equal(
      formatted.split("\n").some((line) => oldPattern.test(line)),
      false,
    );
  });

  it("nothing under src/ falls back to a written-in key", () => {
    const found = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(new URL(file, srcRoot), "utf8").split("\r\n").join("\n");
      for (const line of findFallbacks(text, file)) found.push(`src/${file}:${line}`);
    }
    assert.deepEqual(found, [], "a key must not have a value written in the source");
  });
});
