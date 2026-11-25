# Fix npm audit: effect ReDoS (GHSA-7589-6fvf-x4pw) Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Eliminate the 3 high-severity `npm audit` findings for `effect <=3.22.0` (ReDoS in Schema.TemplateLiteral compiled regex) without downgrading Prisma.

**Architecture:** The vulnerable `effect@3.20.0` is a transitive dependency only — pinned exactly by `@prisma/config@7.10.1` and range-declared by two `@standard-community/*` packages under `hono-openapi`. No app code imports `effect` directly. Fix via an npm `overrides` entry pinning `effect` to the patched release line (3.22.5), which is a backward-compatible v3 minor bump.

**Tech Stack:** npm overrides, Prisma 7 (must NOT be downgraded), vitest / tsc / next build as verification gates.

---

## Current context / assumptions

- `npm audit --audit-level=high` reports:
  ```
  effect <=3.22.0  (GHSA-7589-6fvf-x4pw)
  node_modules/effect
    @prisma/config >=6.13.0-dev.1   (pins effect exactly to 3.20.0)
      prisma >=6.13.0-dev.1
  ```
- Installed tree (`npm ls`): `effect@3.20.0`, depended on by:
  - `node_modules/@prisma/config` → `"effect": "3.20.0"` (exact pin)
  - `node_modules/@standard-community/standard-json` → `^3.20.0`
  - `hono-openapi/node_modules/@standard-community/standard-openapi` → `^3.20.0`
- Latest patched release: **effect@3.22.5** (fixed in 3.22.1+).
- App source (`src/`) has **zero direct imports of `effect`** — it is purely transitive, so a minor bump carries low risk.
- **Do NOT run `npm audit fix --force`.** npm's suggested fix downgrades to `prisma@6.12.0`, which breaks the project's Prisma 7 setup (`@prisma/client@^7.10.1`, `@prisma/adapter-pg@^7.10.1`, `prisma@^7.10.1` in devDependencies, plus `allowScripts` entries for prisma@7.10.1 engines).

## Approach

Add a top-level `overrides.effect` entry to `package.json` (the repo already uses this mechanism for `@hono/node-server` and `readdir-glob/minimatch`), then reinstall and verify with audit + typecheck + tests + build.

---

### Task 1: Add `effect` override to package.json
✅ **DONE** — commit `b1dd132`. Edit applied exactly as specified; JSON validated.

**Objective:** Force the patched effect release across the whole tree via npm overrides.

**Files:**
- Modify: `package.json` (the existing `"overrides"` block, lines ~53-58)

**Step 1: Edit the overrides block**

Current:
```json
"overrides": {
  "@hono/node-server": "^2.1.8",
  "readdir-glob": {
    "minimatch": "^11.0.1"
  }
}
```

New:
```json
"overrides": {
  "@hono/node-server": "^2.1.8",
  "effect": "^3.22.5",
  "readdir-glob": {
    "minimatch": "^11.0.1"
  }
}
```

**Step 2: Verify the edit is valid JSON**

Run: `python3 -c "import json; json.load(open('package.json'))"`
Expected: no output, exit 0.

**Step 3: Commit**

```bash
git add package.json
git commit -m "fix(deps): override effect to ^3.22.5 (GHSA-7589-6fvf-x4pw ReDoS)"
```

### Task 2: Reinstall and confirm the resolved tree
✅ **DONE** — commit `8c8fb4c`. `npm install` changed 1 package, no override conflict (caret range worked; exact-pin fallback not needed). `npm ls effect`: single deduped `effect@3.22.5` under all three subtrees.

**Objective:** Regenerate `package-lock.json` / `node_modules` with the override applied.

**Step 1: Install**

Run: `npm install`
Expected: completes without errors; npm prints an override note for `effect`.

**Step 2: Verify resolved version**

Run: `npm ls effect`
Expected: a single deduped `effect@3.22.x` (>= 3.22.1) node, no `UNMET` / invalid entries, and it appears under `@prisma/config`, `@standard-community/standard-json`, and `@standard-community/standard-openapi`.

If npm reports an override conflict (it can, when a direct dependency pins an exact version that the override range doesn't satisfy), the range `^3.22.5` must be compatible with `3.20.0` — it is not, so npm will apply the override and warn only if some package declares effect as a *direct* dep of the root (it does not). If a hard conflict appears, fallback: pin exactly `"effect": "3.22.5"`.

**Step 3: Commit**

```bash
git add package-lock.json
git commit -m "chore(deps): lock effect 3.22.5 via override"
```

### Task 3: Verify the audit is clean
✅ **DONE** — `npm audit --audit-level=high` → `found 0 vulnerabilities`.

**Objective:** Prove the high-severity findings are gone.

Run: `npm audit --audit-level=high`
Expected: `found 0 vulnerabilities` (or at least zero `effect` / GHSA-7589-6fvf-x4pw entries).

If other non-high advisories remain, that is out of scope — the gate is `--audit-level=high`.

### Task 4: Regression gates (Prisma + app integrity)
✅ **DONE** — typecheck exit 0; vitest 9 files / 60 tests passed; `next build` succeeded with all routes generated. No bisection needed.

**Objective:** Confirm the effect bump didn't break Prisma 7 config loading or the app.

Run, in order:
1. `npm run typecheck` — expected: exit 0.
2. `npm run test` — expected: all vitest suites pass.
3. `npm run build` — expected: `next build` succeeds (this exercises Prisma client generation and server bundle).

If any gate fails, bisect: the only variable is `effect@3.20.0 → 3.22.x`. Report the failure with full output; do not "fix" by reverting silently — escalate as an open question.

### Task 5: Final commit (if lockfile changed during gates) and close-out
✅ **DONE** — no further lockfile drift; final `npm audit --audit-level=high` re-run clean. Plan file committed alongside this update.

**Step 1:** `git status` — if `package-lock.json` changed from build steps, amend/commit it.

```bash
git add -A
git commit -m "chore(deps): post-verification lockfile sync"   # only if needed
```

**Step 2:** Re-run `npm audit --audit-level=high` one last time and paste the clean output into the PR/commit notes.

---

## Files likely to change

- `package.json` — overrides block (+1 line)
- `package-lock.json` — effect entries re-resolved (3 affected subtrees)

No source files expected to change.

## Risks, tradeoffs, and open questions

- **Exact-pin override of `@prisma/config`:** it declares `"effect": "3.20.0"` exactly; the override forces 3.22.x on top. Effect is semver-stable within v3 and Prisma's use (config schema parsing) is standard, so risk is low — but this is why Task 4 gates exist, especially `npm run build` (Prisma client generation).
- **Why not upgrade Prisma to a version that pins fixed effect?** A future `@prisma/config` release may pull in fixed effect naturally; upgrading Prisma major/minor is a much larger change than this audit fix. Revisit at the next scheduled Prisma bump.
- **Why not `npm audit fix --force`?** It downgrades to prisma@6.12.0 — breaking for this project (Prisma 7, adapter-pg 7). Explicitly rejected.
- **Open question:** if npm refuses the override as a conflict in Task 2, use exact pin `"effect": "3.22.5"` instead of the caret range.

## Execution log (2026-11-25) — all tasks complete

- Task 1: override added to `package.json`, committed as `b1dd132`.
- Task 2: `npm install` (changed 1 package, postinstall picomatch guard no-op), lockfile committed as `8c8fb4c`. Resolved tree verified via `npm ls effect` — single deduped `effect@3.22.5`.
- Task 3: `npm audit --audit-level=high` → `found 0 vulnerabilities`.
- Task 4: typecheck exit 0; vitest 9 files / 60 tests passed (328ms); `next build` succeeded, all routes generated.
- Task 5: no lockfile drift after gates; final audit re-run clean. Plan file committed alongside this update.
