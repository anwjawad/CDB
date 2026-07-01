# AGENTS.md - CDB / OncoCoord v3 Project Instructions

## 1. Project Identity

CDB / OncoCoord v3 is a static browser-only oncology coordination dashboard.

Core application files:

- `index.html` - static application shell, tabs, tables, modals, patient drawer, upload controls, and print/export UI.
- `styles.css` - dashboard layout, theme tokens, responsive rules, table styles, drawer styles, print styles, and visual polish.
- `dashboard.js` - all runtime logic: Excel parsing, state management, local cache, filters, charts, analytics, patient search, export, and print workflow.

Current runtime architecture:

- Runtime data source: manually uploaded Excel `.xlsx` tracker.
- Required workbook sheet: `Tracking sheet`.
- Reference workbook sheet: `Lists`.
- Browser cache: `localStorage["dashboard_static_data"]`.
- Current implementation is manual upload plus browser cache. Do not claim OneDrive auto-sync exists unless it is actually implemented and verified.

## Mandatory Skill Selection Protocol

Before planning, editing, debugging, refactoring, testing, documenting, or deploying, Codex must identify the relevant skills for the task.

### How to choose skills

Codex must infer skills from the user request, project type, affected files, risk level, and task goal.

Use these routing rules:

- New feature or unclear requirement:
  `product-requirements-analyst`, `software-architect`, `domain-business-rules`

- CDB static dashboard / Excel upload / workbook parsing:
  `excel-onedrive-dashboard`, `database-designer`, `domain-business-rules`

- UI, layout, buttons, tables, filters, drawer, print styling:
  `frontend-ui-ux`, `redesign-existing-projects`, `safe-refactor-no-regression`

- Bug, blank page, broken button, runtime error, regression:
  `bug-root-cause-finder`, `safe-refactor-no-regression`, `testing-qa-playwright`

- Security, patient data, localStorage, export, print, innerHTML, upload:
  `webapp-security-owasp`, `file-access-vuln`, `injection-checking`

- Testing, smoke tests, no-console-error checks, Playwright:
  `testing-qa-playwright`

- Documentation, README, SECURITY_NOTES, DATA_DICTIONARY, changelog:
  `project-documentation`

- Deployment, GitHub Pages, CDN, release, rollback:
  `deployment-devops`

- Refactor or cleanup:
  `safe-refactor-no-regression`, `testing-qa-playwright`

### Required skill declaration

At the beginning of every non-trivial task, Codex must write:

Relevant skills:

- skill-name: why it is relevant
- skill-name: why it is relevant

Then continue with:

- affected files/functions
- implementation or investigation plan
- risks
- verification steps

### Skill use rule

If the task is simple and no specialized skill is needed, Codex must say:
"No specialized skill needed; using AGENTS.md general rules."

If a task touches patient data, export, print, localStorage, upload, or workbook rendering, Codex must always include `webapp-security-owasp`.

If a task touches existing working behavior, Codex must always include `safe-refactor-no-regression`.

If a task changes UI, Codex must always include `frontend-ui-ux`.

If a task fixes a bug, Codex must always include `bug-root-cause-finder`.

If a task changes Excel parsing or expected workbook columns, Codex must always include `excel-onedrive-dashboard` and `database-designer`.

### Final response requirement

In the final response, Codex must include:

- Skills used
- Files changed
- Verification performed
- Commands run and results
- Patient-data/security implications
- Remaining risks
- Rollback note

## 2. Critical Safety Rules

- Treat all patient data as sensitive clinical data.
- Never use real patient data in tests, screenshots, commits, documentation, examples, issue comments, sample files, or generated reports.
- Never push patient data, exported CSV files, uploaded workbooks, screenshots with patient records, or browser cache dumps to GitHub.
- Do not add public remote sync, OneDrive sync, Microsoft Graph sync, or any external data transmission without explicit user approval.
- Do not assume GitHub Pages is access-controlled. Static hosting does not provide patient-data access control by itself.
- Do not store secrets, API keys, tokens, credentials, or patient data in source code.
- Do not expose full patient records unnecessarily in CSV export, print views, screenshots, logs, or debugging output.
- Do not log full patient identifiers, mobile numbers, diagnoses, notes, or barriers unless explicitly required for a safe local debug session.

## 3. Current Architecture Constraints

- No backend.
- No database server.
- No package manager.
- No build pipeline.
- Static deployment only.
- External dependencies are loaded from CDNs.
- No automated tests exist yet.
- No enforceable authentication or role system exists.
- No source workbook write-back exists. The browser parses uploaded Excel files and stores parsed data locally.

Preserve these constraints unless the user explicitly approves a migration.

## 4. Development Rules

- Inspect existing files before editing.
- Preserve the current static architecture unless a backend/auth/data migration is explicitly approved.
- Do not fully rewrite `dashboard.js` or `styles.css`.
- Make small, reversible changes.
- Keep manual Excel upload working.
- Preserve existing tabs, filters, charts, print workflow, CSV export, `localStorage` cache behavior, patient search, and patient drawer.
- Preserve `KEY_MAP`, header alias mapping, normalization helpers, and `getPatientVal()` patterns unless explicitly changing the Excel schema.
- Use escaped rendering for workbook-derived values. Prefer `textContent`, `escapeHTML()`, or `getEscapedPatientVal()` for patient/workbook data.
- Avoid broad refactors while fixing bugs or adding small features.
- Do not delete files, sample data, or documentation without explicit approval.

## 5. Feature Work Workflow

Before coding any feature:

1. Identify affected files and functions.
2. List the relevant skills/playbooks to use.
3. Explain the implementation plan.
4. Identify patient-data, security, workflow, and regression risks.
5. Define verification steps before editing.
6. Wait for user approval when the change is large, risky, architectural, security-sensitive, schema-changing, deployment-related, or affects export/print/sync behavior.

For approved feature work:

- Keep changes scoped to the smallest useful surface.
- Preserve existing operational workflows and keyboard/mouse paths.
- Add loading, empty, and error states where applicable.
- Document any behavior, data, deployment, or security change.

## 6. Bug Fix Workflow

When fixing a bug:

1. Reproduce it or identify evidence from code, console output, screenshots, or user-provided details.
2. Check browser console, static-server behavior, runtime errors, CDN dependency loading, workbook parsing assumptions, and recent diffs.
3. Find the smallest root cause.
4. Apply a minimal fix.
5. Verify the original bug and nearby workflows.
6. Do not rewrite the app to fix a localized defect.

Nearby workflows to check when relevant:

- App startup and nonblank rendering.
- Excel upload and parsing.
- Initial upload overlay.
- Tabs and sidebar navigation.
- Master table filtering/sorting/pagination.
- Patient drawer.
- Charts.
- Analytics and workflow cards.
- CSV export.
- Print/report generation.
- Settings and cache reset.

## 7. Excel and Data Workflow

When touching upload, parsing, headers, data normalization, filters, or workflow rules:

- Validate workbook sheet names.
- Validate required headers before using workbook data.
- Preserve support for existing English/Arabic header aliases.
- Protect against duplicate records where possible, preferably using stable identifiers such as national ID plus file number when safe.
- Add file size and file type validation when touching upload code.
- Do not write back to the source workbook unless explicitly requested.
- Do not silently change expected Excel headers or column meanings.
- Browser cache is not durable storage. Do not present `localStorage` as backup or authoritative persistence.
- Avoid row-number-as-ID behavior.
- Give users clear parse errors for missing sheets, missing required headers, invalid dates, duplicates, and empty files.
- Use anonymized synthetic workbook data only for tests or examples.

## 8. UI Workflow

When changing UI:

- Preserve operational speed for coordinators and clinical users.
- Buttons must be readable and labeled.
- Statuses need text labels, not color alone.
- Maintain responsive layout.
- Preserve print layout and print-specific CSS.
- Check nonblank rendering after UI changes.
- Keep patient lists scannable.
- Preserve Arabic/English mixed-language readability.
- Keep dangerous or data-removing actions confirmed.
- Do not remove existing user workflows while improving visual design.

## 9. Security Workflow

Prefer defensive hardening and authorized testing only.

When touching data rendering, upload, export, print, storage, or deployment:

- Audit `innerHTML` paths that render workbook-derived data.
- Escape uploaded values before inserting them into HTML.
- Prefer DOM APIs and `textContent` for patient/workbook values.
- Add Content Security Policy only after testing all CDN, print, blob/object URL, and inline-script needs.
- Treat CSV export and print as sensitive-output features.
- Document security implications of every change that affects patient data exposure.
- Do not add credentials or secrets to frontend code.
- Do not rely on hidden UI as security.
- If authentication or roles are needed, design an architecture that can enforce authorization outside static GitHub Pages.

## 10. Testing and Verification

There is no test setup yet. Until one is approved:

- Use `node --check dashboard.js` for JavaScript syntax checks.
- Use a static server for browser smoke tests:

```bash
python -m http.server 8080
```

- Browser smoke tests should verify:
  - [ ] startup renders a nonblank page
  - [ ] no critical console errors
  - [ ] upload overlay appears when no cache exists
  - [ ] tab switching works
  - [ ] settings page opens
  - [ ] Excel upload still accepts `.xlsx`
  - [ ] charts render when data is present
  - [ ] export trigger still works
  - [ ] print trigger still opens the print flow
  - [ ] patient drawer opens from patient rows when data is present

When approved, add minimal Playwright tests for:

- [ ] app startup
- [ ] upload/empty state
- [ ] tab navigation
- [ ] settings page
- [ ] export/print triggers
- [ ] console error capture

Do not claim tests passed unless they were actually run.

## 11. Documentation Rules

- Keep documentation aligned with actual code.
- `README.md` and `CLAUDE.md` currently disagree with the implementation around OneDrive auto-sync.
- Do not claim OneDrive auto-sync, remote refresh, Microsoft Graph sync, or backend persistence exists unless implemented and verified.
- Recommend `SECURITY_NOTES.md` and `DATA_DICTIONARY.md` before major feature work.
- Document known limitations honestly.
- Never document real patient data, real secrets, credentials, tokens, PINs, or private deployment URLs.

## 12. Final Response Format

Every final engineering response for this repository must include:

- Summary.
- Files changed.
- Verification performed.
- Commands run and results.
- Patient-data/security implications.
- Remaining risks.
- Rollback note.

If no files were changed, say so clearly and explain what was inspected.

Never claim success without verification.
