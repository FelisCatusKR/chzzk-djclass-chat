# Protect `main` + collaborator-ready PR workflow

**Date:** 2026-06-11
**Status:** Approved, implemented via PR `chore/main-protection-workflow`

## Problem

The repo used a direct-to-main workflow. A pre-existing Prettier violation
(`src/lib/dj-class.ts`, `tests/shared-db.test.ts`) landed on `main` and turned
CI red, which paused the Dokku production deploy (the `deploy` job in `ci.yml`
has `needs: build`, so the broken build blocked — but did not ship — a release).

Goals (chosen by the maintainer):

1. Stop `main` from going red.
2. Be ready for a future contributor.

## Design

Two complementary layers plus collaborator scaffolding.

### 1. Local guard — husky + lint-staged

- `husky` + `lint-staged` as dev dependencies; `"prepare": "husky"` so hooks
  auto-install on `npm install` for every clone.
- **pre-commit** → `npx lint-staged`: `eslint --fix` + `prettier --write` on
  staged files. Auto-fixes formatting so the originating failure cannot recur.
- **pre-push** → `npm run lint && npm test`. Build stays CI-only (too slow for a
  hook).

### 2. Branch protection on `main` (admin-enforced)

Set via the GitHub API:

- Require a PR before merging.
- Require the `build` status check to pass.
- 0 required approving reviews (solo self-merge once CI is green). Bump to 1
  when a second contributor joins.
- **Include administrators** (strict, no bypass) — best practice: a gate that
  admins can bypass erodes. Emergency escape hatch = temporarily toggle
  protection off, push, re-enable.

### 3. Collaborator scaffolding

- `CONTRIBUTING.md` (Korean, matching repo convention) updated with the hooks
  and the protected-PR flow.
- `.github/PULL_REQUEST_TEMPLATE.md` (Korean) checklist updated to the CI gates.
- No `CODEOWNERS` yet (YAGNI until there is a team).

## Rollout sequence

1. Branch `chore/main-protection-workflow`: format fix + husky/lint-staged +
   doc updates + this spec.
2. Push → open PR → CI green → merge (validates the new flow end-to-end).
3. Enable branch protection requiring `build`, while `main` is green.

Ordering matters: enabling protection blocks direct pushes, so the setup itself
goes through the first PR while protection is still off, then we flip it on.

## Out of scope (YAGNI)

Required approvals > 0, CODEOWNERS, signed commits, merge queue, changing the
Dokku deploy trigger (PR merges still push to `main`, so deploys are unaffected).
