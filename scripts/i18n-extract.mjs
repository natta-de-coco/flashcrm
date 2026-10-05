// Moves the visible English in a .tsx file onto translation keys.
//
// It parses the file with the TypeScript compiler -- no regular expressions over
// source -- and rewrites:
//   - JSX text                          <p>Save contact</p>      → <p>{t("ns.saveContact")}</p>
//   - text attributes                   placeholder="Search"     → placeholder={t("ns.search")}
//   - strings shown from an expression  {busy ? "Saving…" : "Save"}
//   - toast messages                    toast.success("Saved")
//   - a sentence with things inside it  Showing {n} of {total} — <Link>open</Link>
//       → ONE message with {placeholders}, because word order differs between
//         languages and a sentence cut into fragments cannot be translated.
//
// It adds `const { t } = useI18n()` to each component it touched and the import,
// and writes the English dictionary to <out>/<namespace>.en.json. Anything it
// will not guess at -- text in a function that is not a component, a sentence
// wrapped around a block element -- is left alone and listed for a person.
//
// Usage: node scripts/i18n-extract.mjs --out <dir> [--write] <file.tsx> [more...]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const args = process.argv.slice(2);
const write = args.includes("--write");
const outDir = args[args.indexOf("--out") + 1];
const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
if (!outDir || files.length === 0) {
  console.error("usage: node scripts/i18n-extract.mjs --out <dir> [--write] <file.tsx>...");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

/** Attributes whose value is read by a person. */
const TEXT_ATTRS = new Set([
  "placeholder",
  "title",
  "alt",
  "aria-label",
  "aria-description",
  "label",
  "description",
  "emptyText",
  "searchPlaceholder",
  "hint",
  "helperText",
  "tooltip",
  "subtitle",
  "heading",
]);
/** Elements that sit inside a sentence; anything else ends it. */
const INLINE_TAGS = new Set([
  "a",
  "Link",
  "b",
  "strong",
  "em",
  "i",
  "span",
  "code",
  "kbd",
  "u",
  "small",
  "sup",
  "sub",
  "mark",
  "Badge",
  "br",
  "abbr",
]);
/** Text inside these is not prose. */
const VERBATIM_TAGS = new Set(["code", "kbd", "pre", "style", "script", "samp"]);
/** Names that are the same in every language. */
const BRAND_ONLY =
  /^(Flas( CRM)?( AI)?|WhatsApp|Meta|Instagram|Facebook|Messenger|YouTube|TikTok|LinkedIn|Google|X|Paddle|WordPress|Shopify|Pinterest|Snapchat|Telegram|PDF|CSV|JSON|API|SEO|AI|URL|ID|OK|SMS|2FA|QR|CRM|FAQ)$/;

const ENTITIES = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: "\u00a0",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rarr: "→",
  larr: "←",
  copy: "©",
  middot: "·",
  times: "×",
  bull: "•",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  check: "✓",
  trade: "™",
  reg: "®",
};

const hasLetters = (s) => /\p{L}{2,}/u.test(s);
/**
 * An id, a path, an address -- not something to translate. A plain lowercase
 * word ("inactive", "default") IS text when it sits where a person reads it.
 */
const looksLikeToken = (s) => !/\s/.test(s) && /[@/_:#=\\]|\.[a-z]/.test(s);

function decodeEntities(text, warn) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body in ENTITIES) return ENTITIES[body];
    warn(`unknown entity ${match}`);
    return match;
  });
}

/** What React renders for a JSX text node: lines trimmed, joined by one space. */
function jsxEvaluate(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  const kept = [];
  lines.forEach((line, i) => {
    let s = line.replace(/\t/g, " ");
    if (i !== 0) s = s.replace(/^ +/, "");
    if (i !== lines.length - 1) s = s.replace(/ +$/, "");
    if (s) kept.push(s);
  });
  return kept.join(" ");
}

function namespaceFor(file) {
  const base = file
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.tsx$/, "");
  const words = base
    .replace(/\$/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const camel = words
    .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1)))
    .join("");
  return camel === "index" ? "home" : camel;
}

function slugFor(text) {
  const words = text
    .replace(/\{[^}]*\}/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]+$/.test(w))
    .slice(0, 5);
  if (words.length === 0) return "text";
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("")
    .slice(0, 42);
}

let grandTotal = 0;
const summary = [];

for (const file of files) {
  const text = readFileSync(file, "utf8").split("\r\n").join("\n");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ns = namespaceFor(file);
  const dictionary = new Map(); // key → english
  const keyByText = new Map(); // english → key
  const notes = [];
  const usage = new Map(); // component function node → Set("t" | "tr")
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const note = (node, message) => notes.push(`${file}:${lineOf(node)} ${message}`);

  const keyFor = (english) => {
    const existing = keyByText.get(english);
    if (existing) return existing;
    const base = `${ns}.${slugFor(english)}`;
    let key = base;
    for (let n = 2; dictionary.has(key); n++) key = `${base}${n}`;
    dictionary.set(key, english);
    keyByText.set(english, key);
    return key;
  };

  const fnName = (fn) => {
    if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
    const p = fn.parent;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (
      ts.isCallExpression(p) &&
      ts.isVariableDeclaration(p.parent) &&
      ts.isIdentifier(p.parent.name)
    )
      return p.parent.name.text;
    return null;
  };
  /** The component (or hook) a node renders in: the nearest function named like one. */
  const componentOf = (node) => {
    for (let cur = node.parent; cur; cur = cur.parent) {
      if (
        ts.isFunctionDeclaration(cur) ||
        ts.isFunctionExpression(cur) ||
        ts.isArrowFunction(cur)
      ) {
        const name = fnName(cur);
        if (name && /^([A-Z]|use[A-Z])/.test(name)) return cur;
      }
    }
    return null;
  };
  const use = (node, fn) => {
    const component = componentOf(node);
    if (!component) return false;
    if (!usage.has(component)) usage.set(component, new Set());
    usage.get(component).add(fn);
    return true;
  };

  const insideVerbatim = (node) => {
    for (let cur = node.parent; cur; cur = cur.parent) {
      if (ts.isJsxElement(cur)) {
        const tag = cur.openingElement.tagName.getText(sf);
        if (VERBATIM_TAGS.has(tag)) return true;
      }
    }
    return false;
  };

  const translatable = (english) =>
    english &&
    hasLetters(english) &&
    !BRAND_ONLY.test(english.trim()) &&
    !english.includes("{") &&
    !english.includes("}");

  // ── Which string literals are shown to a person ──────────────────────────
  const shown = new Set();
  const markShown = (expr) => {
    if (!expr) return;
    if (
      ts.isStringLiteral(expr) ||
      ts.isNoSubstitutionTemplateLiteral(expr) ||
      ts.isTemplateExpression(expr)
    )
      shown.add(expr);
    else if (ts.isConditionalExpression(expr)) {
      markShown(expr.whenTrue);
      markShown(expr.whenFalse);
    } else if (
      ts.isBinaryExpression(expr) &&
      [
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.PlusToken,
      ].includes(expr.operatorToken.kind)
    ) {
      if (expr.operatorToken.kind === ts.SyntaxKind.PlusToken) markShown(expr.left);
      markShown(expr.right);
    } else if (ts.isParenthesizedExpression(expr)) markShown(expr.expression);
  };
  const findShown = (node) => {
    if (ts.isJsxAttribute(node) && node.initializer && TEXT_ATTRS.has(node.name.getText(sf))) {
      if (ts.isJsxExpression(node.initializer)) markShown(node.initializer.expression);
    } else if (
      ts.isJsxExpression(node) &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      markShown(node.expression);
    } else if (ts.isCallExpression(node)) {
      if (/^toast(\.(success|error|info|warning|message))?$/.test(node.expression.getText(sf)))
        markShown(node.arguments[0]);
    }
    ts.forEachChild(node, findShown);
  };
  findShown(sf);

  // ── Printing: the original text, with replacements where a node is shown ──
  const placeholderName = (expr, taken) => {
    let name = "value";
    let e = expr;
    while (
      e &&
      (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e))
    )
      e = e.expression;
    if (e && ts.isCallExpression(e)) e = e.expression;
    if (e && ts.isIdentifier(e)) name = e.text;
    else if (e && ts.isPropertyAccessExpression(e)) name = e.name.text;
    name = name.replace(/[^A-Za-z0-9]/g, "") || "value";
    name = name[0].toLowerCase() + name.slice(1);
    let unique = name;
    for (let n = 2; taken.has(unique); n++) unique = `${name}${n}`;
    taken.add(unique);
    return unique;
  };

  /**
   * English's plural suffix -- `contact{n === 1 ? "" : "s"}` -- is not a value,
   * it is two wordings. Returns the condition and both endings so the sentence
   * can become two whole messages instead of one with a meaningless "{value}".
   */
  const MARK = "\u0001";
  const pluralSuffix = (expression) => {
    let e = expression;
    while (e && ts.isParenthesizedExpression(e)) e = e.expression;
    if (!e) return null;
    const ending = (n) =>
      (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
      /^[a-z]{0,3}$/.test(n.text);
    if (
      ts.isConditionalExpression(e) &&
      ending(e.whenTrue) &&
      ending(e.whenFalse) &&
      (e.whenTrue.text === "") !== (e.whenFalse.text === "")
    ) {
      return {
        condition: text.slice(e.condition.getStart(sf), e.condition.getEnd()),
        whenTrue: e.whenTrue.text,
        whenFalse: e.whenFalse.text,
      };
    }
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      ending(e.right) &&
      e.right.text !== ""
    ) {
      return {
        condition: text.slice(e.left.getStart(sf), e.left.getEnd()),
        whenTrue: e.right.text,
        whenFalse: "",
      };
    }
    return null;
  };

  function print(node) {
    if (ts.isJsxText(node)) return printJsxText(node);
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) return printJsxParent(node);
    if (ts.isJsxAttribute(node)) {
      const replaced = printAttribute(node);
      if (replaced !== undefined)
        return text.slice(node.getFullStart(), node.getStart(sf)) + replaced;
    }
    if (shown.has(node)) {
      const replaced = printShownLiteral(node);
      if (replaced !== undefined)
        return text.slice(node.getFullStart(), node.getStart(sf)) + replaced;
    }
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return printExpressionArrow(node);
    const generic = printChildren(node);
    if (ts.isBlock(node) && node.parent && usage.has(node.parent))
      return withHook(generic, node, node.parent);
    return generic;
  }

  function printChildren(node, skip) {
    let out = "";
    let pos = node.getFullStart();
    node.forEachChild((child) => {
      if (child === skip) return;
      out += text.slice(pos, child.getFullStart()) + print(child);
      pos = child.getEnd();
    });
    return out + text.slice(pos, skip ? skip.getFullStart() : node.getEnd());
  }

  function hookLine(component) {
    const names = [...usage.get(component)].sort();
    return `const { ${names.join(", ")} } = useI18n();`;
  }

  /** Puts the hook at the top of a component's body, or widens the one there. */
  function withHook(blockText, block, component) {
    const existing = /const \{([^}]*)\} = useI18n\(\);/.exec(blockText);
    const direct = block.statements.some((s) => /=\s*useI18n\(\)/.test(s.getText(sf)));
    if (existing && direct) {
      const have = new Set(
        existing[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      for (const name of usage.get(component)) have.add(name);
      return blockText.replace(
        existing[0],
        `const { ${[...have].sort().join(", ")} } = useI18n();`,
      );
    }
    const brace = blockText.indexOf("{", block.getStart(sf) - block.getFullStart());
    return `${blockText.slice(0, brace + 1)}\n  ${hookLine(component)}${blockText.slice(brace + 1)}`;
  }

  /** `() => <div/>` has no body to put a hook in, so it gets one. */
  function printExpressionArrow(node) {
    const head = printChildren(node, node.body);
    const body = print(node.body);
    if (!usage.has(node)) return head + body;
    return `${head} {\n  ${hookLine(node)}\n  return ${body.trim()};\n}`;
  }

  function printJsxText(node) {
    const raw = text.slice(node.pos, node.end);
    const english = decodeEntities(jsxEvaluate(raw), (m) => note(node, m)).trim();
    if (!translatable(english) || insideVerbatim(node)) return raw;
    if (!use(node, "t")) {
      note(node, `not in a component: "${english.slice(0, 60)}"`);
      return raw;
    }
    const lead = /^\s*/.exec(raw)[0];
    const trail = /\s*$/.exec(raw)[0];
    return `${lead}{t(${JSON.stringify(keyFor(english))})}${trail}`;
  }

  function printAttribute(node) {
    if (!node.initializer || !TEXT_ATTRS.has(node.name.getText(sf))) return undefined;
    if (!ts.isStringLiteral(node.initializer)) return undefined;
    const english = node.initializer.text;
    if (!translatable(english) || looksLikeToken(english)) return undefined;
    if (!use(node, "t")) {
      note(node, `attribute not in a component: "${english.slice(0, 60)}"`);
      return undefined;
    }
    return `${node.name.getText(sf)}={t(${JSON.stringify(keyFor(english))})}`;
  }

  function printShownLiteral(node) {
    if (ts.isTemplateExpression(node)) {
      const taken = new Set();
      let english = node.head.text;
      const values = [];
      const plurals = node.templateSpans.map((span) => pluralSuffix(span.expression));
      const onePlural = plurals.filter(Boolean).length === 1;
      node.templateSpans.forEach((span, i) => {
        if (onePlural && plurals[i]) {
          english += MARK + span.literal.text;
          return;
        }
        const name = placeholderName(span.expression, taken);
        values.push(`${name}: ${print(span.expression).trim()}`);
        english += `{${name}}${span.literal.text}`;
      });
      const prose = english.replace(/\{\w+\}/g, "").replace(MARK, "");
      if (!hasLetters(prose) || BRAND_ONLY.test(prose.trim())) return undefined;
      if (!use(node, "t")) {
        note(node, `template not in a component: "${english.slice(0, 60)}"`);
        return undefined;
      }
      const call = (wording) =>
        values.length
          ? `t(${JSON.stringify(keyForTemplate(wording))}, { ${values.join(", ")} })`
          : `t(${JSON.stringify(keyForTemplate(wording))})`;
      if (onePlural) {
        const plural = plurals.find(Boolean);
        return `(${plural.condition} ? ${call(english.replace(MARK, plural.whenTrue))} : ${call(english.replace(MARK, plural.whenFalse))})`;
      }
      if (plurals.filter(Boolean).length > 1)
        note(node, "several plural suffixes in one string: check the wording");
      // keyFor refuses braces in plain text; a template's own are placeholders.
      return call(english);
    }
    const english = node.text;
    if (!translatable(english) || looksLikeToken(english)) return undefined;
    if (!use(node, "t")) {
      note(node, `string not in a component: "${english.slice(0, 60)}"`);
      return undefined;
    }
    return `t(${JSON.stringify(keyFor(english))})`;
  }

  function keyForTemplate(english) {
    const existing = keyByText.get(english);
    if (existing) return existing;
    const base = `${ns}.${slugFor(english)}`;
    let key = base;
    for (let n = 2; dictionary.has(key); n++) key = `${base}${n}`;
    dictionary.set(key, english);
    keyByText.set(english, key);
    return key;
  }

  const tagOf = (child) =>
    ts.isJsxElement(child)
      ? child.openingElement.tagName.getText(sf)
      : ts.isJsxSelfClosingElement(child)
        ? child.tagName.getText(sf)
        : null;
  const isBlank = (child) =>
    ts.isJsxText(child) && jsxEvaluate(text.slice(child.pos, child.end)).trim() === "";
  const isComment = (child) => ts.isJsxExpression(child) && !child.expression;
  const isSpace = (child) =>
    ts.isJsxExpression(child) &&
    child.expression &&
    ts.isStringLiteral(child.expression) &&
    child.expression.text.trim() === "";
  const containsJsx = (node) => {
    let found = false;
    const walk = (n) => {
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true;
      else ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  };
  const isProse = (child) =>
    ts.isJsxText(child) &&
    translatable(decodeEntities(jsxEvaluate(text.slice(child.pos, child.end)), () => {}).trim());
  /** Something a sentence can carry inside it: a value, or an inline element. */
  const fitsInSentence = (child) => {
    if (ts.isJsxText(child) || isSpace(child)) return true;
    if (ts.isJsxExpression(child))
      return Boolean(child.expression) && !containsJsx(child.expression);
    const tag = tagOf(child);
    return tag !== null && INLINE_TAGS.has(tag.split(".").pop());
  };

  function printJsxParent(node) {
    const opening = ts.isJsxElement(node) ? node.openingElement : node.openingFragment;
    const closing = ts.isJsxElement(node) ? node.closingElement : node.closingFragment;
    const kids = [...node.children];
    const head = text.slice(node.getFullStart(), opening.getFullStart()) + print(opening);
    const tail = print(closing);
    const verbatim = ts.isJsxElement(node) && VERBATIM_TAGS.has(opening.tagName.getText(sf));

    // The span of children that make one sentence: from the first to the last
    // that is not blank, a comment, or a decoration (an icon) at either end.
    const meaningful = (i) => !isBlank(kids[i]) && !isComment(kids[i]);
    const decoration = (i) =>
      ts.isJsxSelfClosingElement(kids[i]) && !INLINE_TAGS.has(tagOf(kids[i]).split(".").pop());
    let first = 0;
    let last = kids.length - 1;
    while (first <= last && (!meaningful(first) || decoration(first) || isSpace(kids[first])))
      first++;
    while (last >= first && (!meaningful(last) || decoration(last) || isSpace(kids[last]))) last--;
    const span = first <= last ? kids.slice(first, last + 1).filter((k) => !isComment(k)) : [];
    const proseCount = span.filter(isProse).length;
    const others = span.filter((k) => !ts.isJsxText(k) && !isSpace(k));
    const sentence =
      !verbatim && proseCount >= 1 && others.length >= 1 && span.every(fitsInSentence);

    if (!sentence) {
      if (!verbatim && proseCount >= 1 && others.length >= 1) {
        note(node, "text mixed with a block element: translated in pieces, check the word order");
      }
      return head + kids.map(print).join("") + tail;
    }
    if (!componentOf(node)) {
      note(node, "sentence not in a component");
      return head + kids.map(print).join("") + tail;
    }

    const taken = new Set();
    const nodes = [];
    let english = "";
    const plurals = span.map((child) =>
      ts.isJsxExpression(child) ? pluralSuffix(child.expression) : null,
    );
    const onePlural = plurals.filter(Boolean).length === 1;
    if (plurals.filter(Boolean).length > 1)
      note(node, "several plural suffixes in one sentence: check the wording");
    for (const [index, child] of span.entries()) {
      if (ts.isJsxText(child)) {
        english += decodeEntities(jsxEvaluate(text.slice(child.pos, child.end)), (m) =>
          note(child, m),
        );
      } else if (isSpace(child)) {
        english += " ";
      } else if (onePlural && plurals[index]) {
        english += MARK;
      } else if (ts.isJsxExpression(child)) {
        const name = placeholderName(child.expression, taken);
        nodes.push(`${name}: ${print(child.expression).trim()}`);
        english += `{${name}}`;
      } else {
        const tag = tagOf(child).split(".").pop();
        let name = tag[0].toLowerCase() + tag.slice(1);
        let unique = name;
        for (let n = 2; taken.has(unique); n++) unique = `${name}${n}`;
        taken.add(unique);
        nodes.push(`${unique}: ${print(child).trim()}`);
        english += `{${unique}}`;
      }
    }
    english = english.replace(/\s+/g, " ").trim();
    // With nothing to place inside it, a sentence is a plain t(); otherwise tr()
    // puts each value or element where the translation says.
    const call = (wording) => {
      const key = JSON.stringify(keyForTemplate(wording));
      if (nodes.length === 0) {
        use(node, "t");
        return `t(${key})`;
      }
      use(node, "tr");
      return `tr(${key}, { ${nodes.join(", ")} })`;
    };
    const plural = onePlural ? plurals.find(Boolean) : null;
    const expression = plural
      ? `${plural.condition} ? ${call(english.replace(MARK, plural.whenTrue))} : ${call(english.replace(MARK, plural.whenFalse))}`
      : call(english);
    const before = kids.slice(0, first).map(print).join("");
    // A comment inside the sentence is kept, just ahead of it.
    const comments = kids
      .slice(first, last + 1)
      .filter(isComment)
      .map((c) => print(c).trim())
      .join("");
    const after = kids
      .slice(last + 1)
      .map(print)
      .join("");
    const leadWs = ts.isJsxText(kids[first])
      ? /^\s*/.exec(text.slice(kids[first].pos, kids[first].end))[0]
      : "";
    const trailWs = ts.isJsxText(kids[last])
      ? /\s*$/.exec(text.slice(kids[last].pos, kids[last].end))[0]
      : "";
    return `${head}${before}${leadWs}${comments}{${expression}}${trailWs}${after}${tail}`;
  }

  let output = print(sf);
  if (usage.size > 0 && !/from "@\/hooks\/useI18n"/.test(output)) {
    const imports = sf.statements.filter(ts.isImportDeclaration);
    const lastImport = imports[imports.length - 1];
    const at = lastImport
      ? output.indexOf(text.slice(lastImport.getStart(sf), lastImport.getEnd()))
      : -1;
    const line = 'import { useI18n } from "@/hooks/useI18n";\n';
    if (at >= 0) {
      const end = at + (lastImport.getEnd() - lastImport.getStart(sf));
      output = `${output.slice(0, end)}\n${line.trimEnd()}${output.slice(end)}`;
    } else output = line + output;
  }

  grandTotal += dictionary.size;
  summary.push(
    `${String(dictionary.size).padStart(4)} keys  ${notes.length ? `${notes.length} to review  ` : ""}${file} → ${ns}`,
  );
  if (write && dictionary.size > 0) {
    writeFileSync(file, output);
    writeFileSync(
      `${outDir}/${ns}.en.json`,
      JSON.stringify(Object.fromEntries(dictionary), null, 2) + "\n",
    );
  }
  if (notes.length) writeFileSync(`${outDir}/${ns}.review.txt`, notes.join("\n") + "\n");
}

for (const line of summary) console.log(line);
console.log(
  `${write ? "extracted" : "would extract"} ${grandTotal} keys from ${files.length} file(s)`,
);
