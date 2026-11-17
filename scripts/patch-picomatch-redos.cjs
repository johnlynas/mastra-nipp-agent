/**
 * Postinstall patch: picomatch ReDoS mitigation (CVE-2026-112366 / GHSA-fc5q-39xc-vjpf)
 *
 * Upstream status as of 2026-11-17: no patched release exists. The advisory
 * range is `<= 4.0.7`; the latest published picomatch IS 4.0.7. The fix lives
 * in open upstream PRs (micromatch/picomatch #238, #246) — none merged yet.
 *
 * What this patch does: it ports PR #238's guard into lib/parse.js. picomatch
 * 4.0.7 already literalizes "risky" repeated extglobs (see
 * analyzeRepeatedExtglob), but that analysis skips single-branch bodies whose
 * branch starts with a bare `*`/`?` quantifier followed by content — e.g.
 * `+(*a)` compiles to `(?:(?=.)(?:[^/]*?a)+)`, a nested quantifier prone to
 * catastrophic backtracking on short crafted inputs (verified: n=19 input
 * takes ~30s to reject). The guard marks those branches risky so picomatch
 * literalizes the pattern (matches only the literal string `+(*a)`), which is
 * exactly the upstream fix's behavior.
 *
 * Idempotent: no-ops if the guard is already present.
 * Remove this patch once a patched picomatch release exists (re-check on
 * mastra/vite upgrades). See SECURITY.md "Accepted risks".
 */
const fs = require('fs');
const path = require('path');

const parsePath = path.join(__dirname, '..', 'node_modules', 'picomatch', 'lib', 'parse.js');
if (!fs.existsSync(parsePath)) {
  console.warn('[picomatch-redos] picomatch not installed; skipping patch');
  process.exit(0);
}

let src = fs.readFileSync(parsePath, 'utf8');
if (src.includes('hasUnsafeLeadingQuantifier')) {
  console.log('[picomatch-redos] guard already present; nothing to do');
  process.exit(0);
}

const anchor = `    combinable = false;

    if (repeatedExtglobRecursion(branch) > max) {`;
if (!src.includes(anchor)) {
  // Anchor moved upstream — fail loudly rather than silently skip.
  console.error('[picomatch-redos] FATAL: expected anchor not found in picomatch lib/parse.js; picomatch version may have changed. Re-verify the patch.');
  process.exit(1);
}

const guard = `    combinable = false;

    if (hasUnsafeLeadingQuantifier(branch)) {
      return { risky: true };
    }

    if (repeatedExtglobRecursion(branch) > max) {`;

const helper = `// [picomatch-redos patch] A branch that starts with a bare (non-parenthesized)
// \`*\`/\`?\` quantifier and has further content after it (e.g. \`*a\`) is unsafe to
// repeat with an outer \`+(...)\`/\`*(...)\`: it compiles to a nested-quantifier regex
// prone to catastrophic backtracking (CVE-2026-112366). Ported from upstream PR #238.
const hasUnsafeLeadingQuantifier = branch => {
  let i = 0;

  while (i < branch.length && (branch[i] === '*' || branch[i] === '?') && branch[i + 1] !== '(') {
    i++;
  }

  return i > 0 && i < branch.length;
};

const repeatedExtglobRecursion = pattern => {`;

src = src.replace(anchor, guard);
src = src.replace('const repeatedExtglobRecursion = pattern => {', helper);

fs.writeFileSync(parsePath, src);
console.log('[picomatch-redos] patched lib/parse.js with leading-quantifier ReDoS guard');
