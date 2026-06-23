# Ruff + djlint Lint/Format — Implementation Plan (code-quality 1/2, before cutover)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt **ruff** (lint + format) for the Python code and **djlint** (lint + format) for the Django templates, configured per cookiecutter-django, applied across the codebase and gated in CI — so the code is consistently formatted and linted before the cutover (and before the Plan ② type-checking pass).

**Architecture:** One config block each in `pyproject.toml` (`[tool.ruff]` + `[tool.djlint]`) mirroring cookiecutter-django, with a small set of pragmatic `ignore`s added for this codebase's domain (magic numbers, exception-message style, intentional nullable/local-import patterns). The work is sequenced: configure → `ruff format` (one mechanical diff) → make `ruff check` clean → `djlint --reformat` + lint the templates → CI gate + local pre-commit hook.

**Tech Stack:** ruff 0.15.x, djlint 1.39.x (both via uv dev deps), GitHub Actions, the existing husky/lint-staged.

---

## Decisions baked in (from brainstorming, 2026-06-23)

- **Tools:** ruff (lint **and** format, replacing the need for flake8/black/isort) + djlint (Django templates), per **cookiecutter-django** (whose 2-tier layout this project already follows). Type-checking (mypy + django-stubs) is the **separate Plan ②**.
- **Config = cookiecutter's**, plus pragmatic `ignore`s for findings that are noise on this codebase (verified by running ruff/djlint against it 2026-06-23): `PLR2004` (domain magic numbers — buttons 4/5/6/8, rate limits, thresholds), `TRY003`/`EM101`/`EM102` (exception-message style), `COM812` (conflicts with the ruff formatter), `S105`/`S106` (false positives on `*_KEY`/`token` names), `DJ001` (channels may legitimately lack tokens → nullable), `PLC0415` (intentional lazy / test-isolation local imports). cookiecutter's own ignores kept: `RUF012`, `S101`, `SIM102`.
- **Real findings ARE fixed** (not blanket-ignored): `ruff format` resolves the formatting/`E501`/`Q000` issues; `ruff check --fix` clears `F401`/`I001`/`RSE102`/`UP041`/`RUF100`/`B007`; `DJ008` (2 models lacking `__str__`) is fixed by adding `__str__`; the few intentional `BLE001`/`RUF006` spots get a documented per-line `# noqa`.
- **djlint:** cookiecutter's config (`profile="django"`, indent 2, ignores `H006/H030/H031/T002`), **plus** ignore `H021` (the `SiteBackground`/widget inline styles are deliberate). `T003` (bare `{% endblock %}`) is **fixed** by naming the endblocks.
- **Line length 88** (cookiecutter default; ~49 files reformat — accepted one-time churn). Knob: bump `line-length` if the wrapping is undesirable.
- **Enforcement:** CI gate (`ruff check` + `ruff format --check` + `djlint`) **and** the existing husky/lint-staged extended to `*.py`/`*.html` for local auto-format (matching the JS pattern).

## Baseline (measured 2026-06-23, so the cleanup is known, not guessed)
`ruff format`: 49/117 files reformat. `ruff check` (cookiecutter select): **219 findings** — ~64 `E501` (mostly fixed by `format`), ~40 auto-fixable, ~75 in the noisy families above (→ `ignore`), leaving ~30 real ones (notably `DJ008` ×2, `RUF006` ×2, `BLE001` ×2, plus singles). `djlint`: 7/7 templates reformat; after cookiecutter's ignores, only `T003` (endblock names) + `H021` (inline styles) remain.

---

### Task 1: Add ruff + djlint + their config

**Files:**
- Modify: `pyproject.toml` (dev deps + `[tool.ruff]` + `[tool.djlint]`)

- [ ] **Step 1: Add the dev dependencies.**

```bash
uv add --dev ruff djlint
```

Expected: `ruff` (~0.15.x) and `djlint` (~1.39.x) added to `[dependency-groups] dev` in `pyproject.toml` and pinned in `uv.lock`.

- [ ] **Step 2: Add the ruff config** to `pyproject.toml` (append these sections):

```toml
[tool.ruff]
extend-exclude = ["*/migrations/*.py", "staticfiles/*"]
# line-length defaults to 88 (cookiecutter-django convention).

[tool.ruff.lint]
select = [
  "A", "ASYNC", "B", "BLE", "C4", "C90", "COM", "DJ", "DTZ", "E",
  "EM", "ERA", "EXE", "F", "FA", "FBT", "FLY", "G", "I", "ICN",
  "INP", "INT", "ISC", "N", "PD", "PERF", "PGH", "PIE", "PL", "PT",
  "PTH", "PYI", "Q", "RET", "RSE", "RUF", "S", "SIM", "SLF",
  "SLOT", "T10", "T20", "TC", "TID", "TRY", "UP", "W", "YTT",
]
ignore = [
  "RUF012",   # cookiecutter: mutable class attrs without ClassVar
  "S101",     # cookiecutter: assert (used throughout tests)
  "SIM102",   # cookiecutter: nested-if collapsing
  "COM812",   # conflicts with the ruff formatter (it manages trailing commas)
  "PLR2004",  # magic-value comparison — domain numbers (buttons 4/5/6/8, limits, thresholds)
  "TRY003",   # long messages in raise — fine for this app
  "EM101",    # string literal in exception — low-value churn
  "EM102",    # f-string in exception
  "S105",     # hardcoded-password false positives on *_KEY / token var names
  "S106",     # same, in call args (test dummies)
  "DJ001",    # nullable string fields are intentional (a Channel may have no tokens yet)
  "PLC0415",  # lazy / test-isolation local imports are intentional here
]

[tool.ruff.lint.isort]
force-single-line = true

[tool.ruff.lint.per-file-ignores]
"**/tests/**" = ["PT011", "B017", "PT018"]  # broad pytest.raises / composite asserts are fine in tests
```

- [ ] **Step 3: Add the djlint config** to `pyproject.toml`:

```toml
[tool.djlint]
profile = "django"
indent = 2
blank_line_after_tag = "load,extends"
close_void_tags = true
format_css = true
format_js = true
max_line_length = 119
# cookiecutter ignores + H021 (the SiteBackground / widget inline styles are deliberate).
ignore = "H006,H030,H031,T002,H021"
include = "H017,H035"
css.indent_size = 2
js.indent_size = 2
```

- [ ] **Step 4: Verify the tools load the config** (no formatting yet):

```bash
uv run ruff check --version
uv run djlint --version
uv run ruff check djclass_overlay config manage.py 2>&1 | tail -1   # shows the finding count under the config
```

Expected: versions print; `ruff check` reports a finding count (it's not clean yet — that's Tasks 2-3).

- [ ] **Step 5: Commit.**

```bash
git add pyproject.toml uv.lock
git commit -m "build: add ruff + djlint with cookiecutter-django config"
```

---

### Task 2: `ruff format` the codebase

The big mechanical, behaviour-preserving reformat. Done first so later annotation/lint work happens on formatted code.

**Files:** all `*.py` under `djclass_overlay/`, `config/`, `manage.py` (migrations excluded by config).

- [ ] **Step 1: Format.**

```bash
uv run ruff format djclass_overlay config manage.py
```

Expected: "49 files reformatted, 68 files left unchanged" (counts approximate).

- [ ] **Step 2: Verify behaviour is unchanged** — the full suite must still pass (formatting changes whitespace only):

```bash
uv run pytest -q
```

Expected: still green (131 passed). If any test fails, a format change exposed a latent issue — STOP and investigate (don't proceed).

- [ ] **Step 3: Commit.**

```bash
git add -A
git commit -m "style: ruff format the Python codebase"
```

> Use `git add -A` here because the reformat touches many files; confirm `git status` shows only `*.py` changes (no stray artifacts).

---

### Task 3: Make `ruff check` clean

Auto-fix what's safe, fix the real findings, and `# noqa` the genuinely-intentional ones — until `ruff check` exits 0.

**Files:** primarily `djclass_overlay/**` (the models for `DJ008`; the overlay lifecycle for `RUF006`; the OAuth/varchive code for `BLE001`).

- [ ] **Step 1: Apply the safe auto-fixes.**

```bash
uv run ruff check djclass_overlay config manage.py --fix
```

Expected: ~40 fixes applied (`F401` unused imports, `I001` import order, `RSE102` redundant parens on `raise X()`, `UP041`, `RUF100` unused-noqa, `B007`, …). Then re-run `uv run ruff check djclass_overlay config manage.py` to see what remains.

- [ ] **Step 2: Fix `DJ008`** — add `__str__` to the two flagged models (run `ruff check ... | grep DJ008` to confirm which; expected `viewers.VarchiveToken` and one of `djclass.DjClass` / `streamers.Channel`). Add a readable `__str__`, e.g. in `djclass_overlay/viewers/models.py`:

```python
    def __str__(self):
        return self.varchive_nickname
```

and in `djclass_overlay/djclass/models.py` (if `DjClass` is flagged):

```python
    def __str__(self):
        return f"{self.user} {self.button}B {self.dj_class}"
```

(Match the actual flagged models; give each a one-line `__str__` returning its most identifying field.)

- [ ] **Step 3: `# noqa` the intentional remainders** (each with a reason). Run `ruff check ...` and for each residual finding apply the obvious fix OR a documented per-line noqa:
  - **`RUF006`** (asyncio dangling task, ×2 — the overlay flush/ingestor lifecycle tasks): these are owned by `overlay/lifecycle.py` (cancelled on shutdown), not leaked. If the task is already stored/cancelled there, append `# noqa: RUF006 — task is held + cancelled by overlay.lifecycle`; if it is NOT referenced anywhere, store it (e.g. in the registry/lifecycle set) instead of noqa.
  - **`BLE001`** (blind `except Exception`, ×2 — batch resilience in the OAuth callback + any not-yet-annotated spot; `sync_djclass` already has the noqa): append `# noqa: BLE001 — one failure must not abort the batch/login`.
  - **Singles** (`SIM105`, `ASYNC110`, `C901`, `ERA001`, `N818`, `PERF401`, `PTH123`, `S110`, `SLF001`, `PLW0603`, `T20` if any): apply the trivial fix where clean — `ERA001` delete commented-out code; `PTH123` use `Path.open`; `PERF401` use a list comprehension; `SIM105` use `contextlib.suppress`; `ASYNC110` (the `runasgi` should_exit poll) → `# noqa: ASYNC110 — intentional 0.1s should_exit poll`; `PLW0603`/`SLF001`/`S110`/`C901`/`N818` → fix if trivial, else `# noqa: <rule> — <reason>`. Each `noqa` MUST name the rule + a reason.

- [ ] **Step 4: Confirm clean + suite green.**

```bash
uv run ruff check djclass_overlay config manage.py
uv run pytest -q
```

Expected: `ruff check` → "All checks passed!"; suite still 131 green.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "style: ruff check clean (fixes + __str__ + documented noqas)"
```

---

### Task 4: djlint — reformat + lint the templates clean

**Files:** the 7 templates under `djclass_overlay/templates/` (`base.html`, `pages/landing.html`, `users/{login,dashboard}.html`, `viewers/{link,_link_badge}.html`, `overlay/widget.html`).

- [ ] **Step 1: Reformat.**

```bash
uv run djlint djclass_overlay/templates --reformat
```

Expected: "7 files updated" (indent 2, attribute wrapping, embedded CSS/JS).

- [ ] **Step 2: Fix `T003`** — name every bare `{% endblock %}` after its block. In each template, change `{% endblock %}` → `{% endblock <name> %}` matching the opening `{% block <name> %}` (e.g. `{% block content %}…{% endblock content %}`, `{% block title %}…{% endblock title %}`). (`{% endpartialdef %}` is unaffected — `T003` is only about `endblock`.)

- [ ] **Step 3: Lint clean + suite green.**

```bash
uv run djlint djclass_overlay/templates --lint
uv run pytest -q
```

Expected: djlint lint → no errors (H021 is config-ignored; T003 fixed); suite still 131 green (the page-content tests assert Korean strings + attributes, which the reformat + endblock-naming preserve). If a content test fails, a reformat changed an asserted substring — STOP and reconcile (adjust the test or the template).

- [ ] **Step 4: Commit.**

```bash
git add djclass_overlay/templates/
git commit -m "style: djlint reformat templates + name endblocks"
```

---

### Task 5: CI gate + local pre-commit hook

**Files:** `.github/workflows/ci.yml` (add lint steps), `package.json` (extend lint-staged).

- [ ] **Step 1: Add the lint steps to the CI `build` job.** In `.github/workflows/ci.yml`, after the `uv run pytest -q` step (and before/after the deploy-check), add:

```yaml
      - run: uv run ruff check djclass_overlay config manage.py
      - run: uv run ruff format --check djclass_overlay config manage.py
      - run: uv run djlint djclass_overlay/templates --check
      - run: uv run djlint djclass_overlay/templates --lint
```

> These are static (no Django setup / DB / env needed). Keep the existing `build` env + `deploy` job unchanged.

- [ ] **Step 2: Extend lint-staged for local auto-format.** In `package.json`, change the `lint-staged` block to add Python + HTML (keep the JS/CSS entries):

```json
  "lint-staged": {
    "*.{ts,tsx,js}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{css,md,json,jsonc,yml,yaml}": "prettier --write",
    "*.py": [
      "uv run ruff format",
      "uv run ruff check --fix"
    ],
    "*.html": "uv run djlint --reformat"
  },
```

> `.husky/pre-commit` already runs `npx lint-staged`, so staged `.py`/`.html` now auto-format + auto-fix on commit (matching the JS prettier pattern). uv is on PATH in the hook environment.

- [ ] **Step 3: Verify the CI commands pass locally** (mirrors what CI will run):

```bash
uv run ruff check djclass_overlay config manage.py
uv run ruff format --check djclass_overlay config manage.py
uv run djlint djclass_overlay/templates --check
uv run djlint djclass_overlay/templates --lint
```

Expected: all four clean (ruff "All checks passed!", format "would be left unchanged", djlint no diffs / no lint errors).

- [ ] **Step 4: Commit.**

```bash
git add .github/workflows/ci.yml package.json
git commit -m "ci: gate ruff + djlint; auto-format Python/HTML in pre-commit"
```

---

## Self-Review

- **Decisions honored:** cookiecutter ruff + djlint config ✓; pragmatic ignores for measured noise (PLR2004/TRY003/EM/COM812/S105-106/DJ001/PLC0415) ✓; real findings fixed not blanket-ignored (ruff format + --fix, DJ008 `__str__`, documented noqas) ✓; djlint H021 ignored + T003 fixed ✓; CI gate + lint-staged hook ✓; line-length 88 ✓; type-checking deferred to Plan ② ✓.
- **Sequencing:** configure (1) → format (2) → lint-clean (3) → templates (4) → enforce (5); format before lint so the formatter resolves E501/quotes first; everything before the Plan ② annotation pass.
- **Behaviour safety:** ruff format + djlint reformat are whitespace/style only; each task re-runs `pytest -q` (must stay 131 green). The only logic-touching change is adding `__str__` (new method, no behaviour change) — covered by the suite staying green.
- **Placeholders:** none — config is complete; the lint cleanup is enumerated from a real run (counts + rules + the specific fixes), with directed per-rule guidance for the ~10 residual singles (each → trivial fix or named-noqa-with-reason, goal = `ruff check` exits 0).
- **Name/version consistency:** ruff 0.15.x / djlint 1.39.x via `uv add --dev`; `[tool.ruff.lint]` select/ignore + `[tool.ruff.lint.isort]` + `[tool.ruff.lint.per-file-ignores]` are the current (0.15) config layout; `[tool.djlint]` keys match 1.39; CI steps + lint-staged globs target the same paths.
- **Deliverable:** a consistently ruff-formatted + ruff-clean Python codebase and djlint-clean templates, gated in CI and auto-formatted on commit — ready for Plan ② (mypy type-checking), then the Plan 9 cutover.
