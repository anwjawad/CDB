# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OncoCoord v3** — a fully serverless, client-side oncology patient coordination dashboard. No backend, no build step, no package manager. Runs entirely in the browser; hostable on GitHub Pages or any static file server.

## Running the App

Open `index.html` directly in a browser, or run:
```
python -m http.server 8080
```
Then open `http://localhost:8080`. There is no `npm install`, no compilation, no dev server.

## Architecture

Three files only:

- **`index.html`** — static shell with all tabs, tables, modals, the patient-detail drawer, and the triage banner pre-rendered in HTML. Dynamic content targets are `<tbody id="...">`, KPI `<span>` elements, and badge counts — all populated by JS.
- **`styles.css`** — CSS custom properties design system. Dark/light theme is toggled by swapping `.dark-theme` / `.light-theme` on `<body>`. All color tokens are CSS variables in `:root`; `.light-theme` overrides only the variables that change.
- **`dashboard.js`** — all application logic, vanilla JS, no frameworks.

### CDN Dependencies (no local copies)

Loaded in `index.html` `<head>`:
- **Chart.js** — 4 charts in the Overview tab
- **SheetJS `xlsx@0.18.5`** — client-side `.xlsx` parsing (the `XLSX` global)
- **FontAwesome 6.4** — icons
- **Google Fonts** — Outfit (Latin UI) + Tajawal (Arabic text)

`ensureRuntimeDependencies()` checks `typeof Chart` and `typeof XLSX` at startup and shows a toast if either is missing.

### Data Flow

1. `initApp()` runs on `DOMContentLoaded`. It chains: `fetchConfig()` → `loadDashboardData({ silent: true })` → `syncRemoteTracker({ showOverlay: true })` → `startRemoteAutoRefresh()`.
2. `loadDashboardData` reads `localStorage["dashboard_static_data"]` and renders cached data immediately (stale-while-revalidate).
3. `syncRemoteTracker` fetches the OneDrive `.xlsx` via `fetchRemoteWorkbookArrayBuffer()`, which tries two URL candidates: the OneDrive API sharing form (`api.onedrive.com/v1.0/shares/u!<encoded>`) and a direct `?download=1` variant.
4. The downloaded `ArrayBuffer` is parsed by `processWorkbook()` using SheetJS. This reads the "Tracking sheet" (auto-detects the header row by looking for "Patient Name" / "اسم المريض") and the "Lists" sheet.
5. `applyDashboardData(patients, lists, metadata)` writes the result to `localStorage`, then calls the render pipeline: `populateFilterOptions()` → `calculateKPIs()` → `renderCharts()` → `applyFilters()` → `updateBadges()`.
6. Auto-refresh fires every 5 minutes via `remoteRefreshTimer` (`setInterval`). It also fires on `window focus` and `document visibilitychange`.

All storage access goes through `readStorage` / `writeStorage` / `removeStorage` — never `localStorage` directly.

### Key Mapping (`KEY_MAP`)

Excel column headers vary (English/Arabic, trailing spaces). **Never access `pat['Column Name']` directly.** Always use:

```js
getPatientVal(pat, 'fieldKey')       // returns raw string
getEscapedPatientVal(pat, 'fieldKey') // HTML-escaped, safe for innerHTML
```

`KEY_MAP` in `dashboard.js:115` lists every alias for each logical field (`name`, `id`, `file`, `clinic`, `visitDate`, `division`, `diagnosis`, `coordinator`, `mobile`, `physician`, `referralType`, `referralForms`, `permitSent`, `otherAppt`, `guidance`, `treatmentPlan`, `ncm`, `ncmDecision`, `treatmentReferralStatus`, `otherReferralStatus`, `permitStatus`, `chemoDate`, `notified`, `notifiedOther`, `barrier`, `notes`, `status`).

### Value Normalization

`normalizeValue(value)` strips whitespace, Unicode-normalizes (NFKC), and lowercases. **All field comparisons must go through the helper functions** — never compare raw strings:

```js
isYesValue(v)      isNoValue(v)      isPendingValue(v)
isApprovedValue(v) isRejectedValue(v) isTreatmentValue(v)
isEmptyLike(v)     isValidDateValue(v)  // checks YYYY-MM-DD format
```

These read from `VALUE_ALIASES` which covers both English and Arabic equivalents.

### Tab System

Tabs are pre-rendered in `index.html` as `<section class="tab-pane" id="tab-<name>">`. `setupTabSwitching()` toggles the `.active` class. Each tab has a dedicated render function triggered on switch:

| Tab | Render function |
|-----|----------------|
| `master` | `applyFilters()` → `renderMainTable()` |
| `patient-search` | `renderPatientSearchResults()` |
| `followup` | `renderFollowupTab()` |
| `ncm` | `renderNcmTab()` |
| `inpatient` | `renderInpatientTab()` |
| `outpatient` | `renderOutpatientTab()` |
| `barriers` | `renderBarriersTab()` |
| `analytics` | `renderAnalyticsTab()` |

### Smart Notes System (9 Rules)

`getSmartNotes(pat)` runs 9 rule predicates against a single patient and returns an array of `{ title, description, level, chipText, icon }` objects. Levels: `"ok"`, `"warning"`, `"danger"`.

`generateSmartNotesChips(pat)` renders these as `<span class="smart-note-chip sn-<level>">` elements shown inline in the Master Registry table's last column.

Rules (in order in `dashboard.js`):
1. Permit form sent + permit status is pending
2. NCM = Yes + NCM decision empty
3. Guidance not completed + referral approved
4. Referral forms sent + other referral status pending
5. Referral type is Without/Evaluation/Follow-up + treatment referral pending
6. NCM = Yes + chemo date missing/invalid
7. Chemo date valid + patient not notified
8. Referral approved, NCM = No, type = Treatment + chemo date missing
9. Referral approved, NCM = Yes, type = Treatment + chemo date missing
10. Active barrier (bonus rule — `hasActiveBarrier()`)

When adding rules, update both `getSmartNotes` and, if needed, the corresponding badge count in `updateBadges()`.

### Charts

`renderCharts()` destroys any existing `charts.*` instances before creating new ones. The `charts` object holds: `clinic` (stacked bar), `referral` (doughnut), `diagnoses` (horizontal bar), `coordinators` (vertical bar). On theme switch, `updateChartsTheme()` destroys and recreates all charts with the new text/grid colors.

### Patient Drawer

`openPatientDrawer(pat)` populates and shows `#patient-detail-drawer`. It calls `renderPatientTimeline(pat)` to build the 6-step coordination timeline (Clinic Visit → Referral → NCM → Permit → Chemo → Notified) and `getSmartNotes(pat)` to show action items. Close via `setupDrawerClose()`.

### Print System

`setupPrinting()` populates a column picker modal from `ALL_EXCEL_COLUMNS` (defined at `dashboard.js:2732`). The user selects columns, then `buildPrintContent()` generates a standalone HTML document injected into a hidden `<iframe>` and printed. Operates on `filteredPatients` (respects current filters).

### Storage Keys

```js
STORAGE_KEYS = {
    theme:      "theme",
    config:     "dashboard_config",       // { onedrive_url }
    data:       "dashboard_static_data",  // { patients[], lists{}, metadata{} }
    remoteMeta: "dashboard_remote_metadata"
}
```

### Excel Workbook Requirements

- Sheet **"Tracking sheet"**: patient records; first column of the header row must contain "Patient Name" or "اسم المريض". Leading metadata rows above the header are safe.
- Sheet **"Lists"**: coordinator/clinic/division dropdown reference data; read by `processWorkbook` and stored in `dropdownLists`.

Date cells are converted to `YYYY-MM-DD` strings by `excelValueToString()` / `excelDateToStr()`. Raw `0` and `0.0` numeric values are treated as empty by `cleanValueJS()`.

## Available Project Skills

`.claude/skills/userinterface-wiki` — UI/UX rules for animation, typography, CSS pseudo-elements, prefetching, and accessibility. Invoke with `/userinterface-wiki`.
