// Rewrites Tailwind's left/right utilities to their logical equivalents, so a
// right-to-left language mirrors the layout instead of keeping it pinned.
//
//   ml-2 → ms-2   mr-2 → me-2   pl-9 → ps-9   pr-2 → pe-2
//   left-3 → start-3   right-0 → end-0   text-left → text-start
//   rounded-l-md → rounded-s-md   border-l → border-s   (and the r/tl/tr/bl/br forms)
//
// In left-to-right the logical class computes to exactly the physical one, so
// English is unchanged by construction. Left alone on purpose:
//   - left-1/2 / right-1/2: centring paired with -translate-x-1/2, which does
//     not flip; logical positioning there would push the element off-centre.
//   - src/components/ui: shadcn primitives with their own direction handling.
//   - anything in --skip (files another open PR is rewriting).
//
// Usage: node scripts/rtl-logical-classes.mjs [--write] [--skip a.tsx,b.tsx] <files...>
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const write = args.includes("--write");
const skipIndex = args.indexOf("--skip");
const skip = skipIndex >= 0 ? args[skipIndex + 1].split(",") : [];
const files = args.filter((a, i) => !a.startsWith("--") && (skipIndex < 0 || i !== skipIndex + 1));

const PAIRS = [
  ["ml", "ms"],
  ["mr", "me"],
  ["pl", "ps"],
  ["pr", "pe"],
  ["left", "start"],
  ["right", "end"],
  ["rounded-l", "rounded-s"],
  ["rounded-r", "rounded-e"],
  ["rounded-tl", "rounded-ss"],
  ["rounded-tr", "rounded-se"],
  ["rounded-bl", "rounded-es"],
  ["rounded-br", "rounded-ee"],
  ["border-l", "border-s"],
  ["border-r", "border-e"],
];

// A class token: optional variants (sm:, hover:, rtl:), optional minus, a
// physical prefix, and a value -- or one of the value-less forms.
const TOKEN =
  /(?<=^|[\s"'`{(])((?:[a-z0-9-]+:)*)(-?)(ml|mr|pl|pr|left|right|rounded-(?:tl|tr|bl|br|l|r)|border-(?:l|r))(-[0-9a-z./[\]%]+)?(?=$|[\s"'`})])|(?<=^|[\s"'`{(])((?:[a-z0-9-]+:)*)text-(left|right)(?=$|[\s"'`})])/g;

const tally = new Map();
let changedFiles = 0;

for (const file of files) {
  if (file.includes("/components/ui/") || skip.some((s) => file.endsWith(s))) continue;
  const source = readFileSync(file, "utf8");
  // Only inside className-ish strings: a quick guard against rewriting prose.
  const next = source.replace(
    /(className|class|activeProps|inactiveProps)=(\{[^}]*\}|"[^"]*"|'[^']*')|cn\([^)]*\)|`[^`]*`/g,
    (chunk) =>
      chunk.replace(TOKEN, (match, variants, minus, prefix, value, textVariants, textSide) => {
        if (textSide) {
          const out = `${textVariants}text-${textSide === "left" ? "start" : "end"}`;
          tally.set(`text-${textSide}`, (tally.get(`text-${textSide}`) ?? 0) + 1);
          return out;
        }
        // Spacing and position utilities always carry a value (ml-2, left-3).
        // A bare "left" or "right" is a word -- `${left} days left` in a
        // template string -- and must never be touched.
        if (["ml", "mr", "pl", "pr", "left", "right"].includes(prefix) && !value) return match;
        // Centring: left-1/2 or right-1/2 travels with a translate that does not flip.
        if ((prefix === "left" || prefix === "right") && value === "-1/2") return match;
        // rounded-l-md etc. need a value only for rounded-*; bare rounded-l is valid too.
        const logical = PAIRS.find(([p]) => p === prefix)?.[1];
        if (!logical) return match;
        tally.set(prefix, (tally.get(prefix) ?? 0) + 1);
        return `${variants}${minus}${logical}${value ?? ""}`;
      }),
  );
  if (next !== source) {
    changedFiles++;
    if (write) writeFileSync(file, next);
  }
}

for (const [prefix, count] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(4)} ${prefix}`);
}
console.log(`${write ? "rewrote" : "would rewrite"} ${changedFiles} file(s)`);
