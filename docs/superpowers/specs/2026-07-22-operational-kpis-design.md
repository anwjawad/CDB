# Phase 1: Operational KPIs — Aging, Data Completeness, Referral Turnaround

## Context

OncoCoord v3 is a serverless, client-side dashboard (`index.html` + `styles.css` + `dashboard.js`, no build step). All patient data lives in `patientsData` (parsed from an uploaded `.xlsx`) and is re-rendered on every filter/tab change. This is Phase 1 of a larger roadmap (Operational KPIs → Workload & Capacity → Snapshot History → Daily Digest → RTL), scoped independently so it can ship and be verified on its own.

**Data constraint driving this design:** the Excel tracker only has two real date fields — `visitDate` ("Date of clinic visit") and `chemoDate` ("chemotherapy Appointment Date"). There is no per-stage date (referral sent, permit sent, NCM date), so all time-based metrics are anchored to `visitDate` only.

## Goals

Add three new operational metrics, all computed client-side from existing `patientsData`, with no changes to the Excel schema or `KEY_MAP`:

1. **Aging / SLA** — how many days a still-in-progress patient has been waiting since their clinic visit, bucketed.
2. **Data Completeness Score** — % of the 27 `KEY_MAP` fields that are filled in, averaged across active patients.
3. **Referral Turnaround Time** — average days from clinic visit to chemo appointment, for patients who reached that stage.

## New Helper Functions (`dashboard.js`)

Add alongside the existing `VALUE_ALIASES` / `isYesValue`-style helpers, following the same conventions:

```js
// New alias group
VALUE_ALIASES.closed = ["closed", "completed", "complete", "discharged", "مكتمل", "مغلق", "منتهي"];

function isClosedValue(value) { return valueMatches(value, "closed"); }
function isClosedCase(pat) { return isClosedValue(getPatientVal(pat, 'status')); }

// Aging
function getPatientAgingDays(pat) {
    if (isClosedCase(pat)) return null;
    if (isValidDateValue(getPatientVal(pat, 'chemoDate'))) return null; // already reached Chemo Scheduled
    const visitDate = getPatientVal(pat, 'visitDate');
    if (!isValidDateValue(visitDate)) return null;
    const diffMs = Date.now() - new Date(visitDate + "T00:00:00").getTime();
    return Math.floor(diffMs / 86400000);
}

function getAgingBucket(days) {
    if (days === null) return null;
    if (days <= 3) return '0-3';
    if (days <= 7) return '4-7';
    if (days <= 14) return '8-14';
    return '15+';
}

// Data completeness
function getPatientCompleteness(pat) {
    const keys = Object.keys(KEY_MAP);
    const filled = keys.filter(k => !isEmptyLike(getPatientVal(pat, k))).length;
    return (filled / keys.length) * 100;
}

function computeAvgCompleteness() {
    const eligible = patientsData.filter(pat => !isClosedCase(pat));
    if (eligible.length === 0) return 0;
    const total = eligible.reduce((sum, pat) => sum + getPatientCompleteness(pat), 0);
    return Math.round(total / eligible.length);
}

// Turnaround
function computeAvgTurnaroundDays() {
    const diffs = [];
    patientsData.forEach(pat => {
        const visitDate = getPatientVal(pat, 'visitDate');
        const chemoDate = getPatientVal(pat, 'chemoDate');
        if (!isValidDateValue(visitDate) || !isValidDateValue(chemoDate)) return;
        const diff = (new Date(chemoDate) - new Date(visitDate)) / 86400000;
        if (diff >= 0) diffs.push(diff);
    });
    if (diffs.length === 0) return null;
    return Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10;
}
```

`getPatientAgingDays`/`getAgingBucket` are also used to build a per-patient list for each bucket (needed for the quick-filter click-through), via a helper `matchesAgingBucket(pat, bucketKey)` that calls `getAgingBucket(getPatientAgingDays(pat)) === bucketKey`.

## Quick Filter Integration

Extend the existing `matchesPatientQuickFilter(pat, filterName)` switch (in `dashboard.js`, no structural change) with 5 new cases:

- `'data-incomplete'` → `getPatientCompleteness(pat) < 100`
- `'aging-0-3'`, `'aging-4-7'`, `'aging-8-14'`, `'aging-15-plus'` → `getAgingBucket(getPatientAgingDays(pat)) === '<bucket>'`

These reuse the existing `currentQuickFilters` Set / `setQuickFilters()` / `switchToMasterTab()` pattern already used by all Overview KPI cards — no new filtering architecture needed.

## UI: Overview Tab

Add a new section below the existing `.kpi-grid` in `index.html`, inside `#tab-overview`:

```html
<div class="dashboard-section-header">
    <h3>Operational KPIs</h3>
</div>
<div class="kpi-grid" id="operational-kpi-grid">
    <!-- Data Completeness -->
    <div class="kpi-card glass-card ripple" id="okpi-completeness">
        <div class="kpi-icon icon-blue"><i class="fa-solid fa-list-check"></i></div>
        <div class="kpi-data">
            <h3>Data Completeness</h3>
            <p class="kpi-value" id="okpi-completeness-val">0%</p>
            <span class="kpi-context">Avg. across active files</span>
        </div>
    </div>
    <!-- Avg Referral Turnaround -->
    <div class="kpi-card glass-card ripple" id="okpi-turnaround">
        <div class="kpi-icon icon-indigo"><i class="fa-solid fa-hourglass-half"></i></div>
        <div class="kpi-data">
            <h3>Avg. Referral Turnaround</h3>
            <p class="kpi-value" id="okpi-turnaround-val">—</p>
            <span class="kpi-context">Visit → Chemo, days</span>
        </div>
    </div>
    <!-- Aging buckets -->
    <div class="kpi-card glass-card ripple" id="okpi-aging-0-3">
        <div class="kpi-icon icon-green"><i class="fa-solid fa-hourglass-start"></i></div>
        <div class="kpi-data"><h3>Aging: 0-3 days</h3><p class="kpi-value" id="okpi-aging-0-3-val">0</p><span class="kpi-context">Since clinic visit</span></div>
    </div>
    <div class="kpi-card glass-card ripple" id="okpi-aging-4-7">
        <div class="kpi-icon icon-blue"><i class="fa-solid fa-hourglass-half"></i></div>
        <div class="kpi-data"><h3>Aging: 4-7 days</h3><p class="kpi-value" id="okpi-aging-4-7-val">0</p><span class="kpi-context">Since clinic visit</span></div>
    </div>
    <div class="kpi-card glass-card ripple" id="okpi-aging-8-14">
        <div class="kpi-icon icon-amber"><i class="fa-solid fa-hourglass-end"></i></div>
        <div class="kpi-data"><h3>Aging: 8-14 days</h3><p class="kpi-value" id="okpi-aging-8-14-val">0</p><span class="kpi-context">Since clinic visit</span></div>
    </div>
    <div class="kpi-card glass-card ripple" id="okpi-aging-15-plus">
        <div class="kpi-icon icon-danger"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="kpi-data"><h3>Aging: 15+ days</h3><p class="kpi-value" id="okpi-aging-15-plus-val">0</p><span class="kpi-context">Since clinic visit</span></div>
    </div>
</div>
```

All 6 cards reuse existing `.kpi-card`/`.glass-card`/`.ripple`/`.icon-*` classes — no new CSS needed for the cards themselves. `.dashboard-section-header` does **not** exist yet in `styles.css` (verified) — it needs one small new rule (margin-top + font-size/weight matching the existing `.card-header h3` look at `styles.css:387`). This is the only new CSS in this phase.

## Wiring (`dashboard.js`)

- New `renderOperationalKPIs()` function, called from `calculateKPIs()` (same place `updateMasterFunnel()` and `updateTriageBanner()` are already called) so it refreshes on every data load/filter cycle.
- New `setupOperationalKPIClicks()` function, called from `initApp()` alongside `setupInteractiveKPIs()`. Wires each of the 6 cards to `setQuickFilters([...])` + `pagination.currentPage = 1` + `applyFilters()` + `switchToMasterTab()` — identical pattern to the existing KPI card click handlers.

## Edge Cases

- No `visitDate` → patient excluded from aging bucket counts and from turnaround average, but still included in completeness scoring (missing field just lowers their %).
- `chemoDate` earlier than `visitDate` (data entry error) → excluded from turnaround average silently; already surfaced separately via the existing "Data Problems" quick filter (problem #2: chemo date without approved referral covers related cases, though not this exact one — out of scope for this phase).
- Zero eligible patients for a metric → Data Completeness shows `0%`, Turnaround shows `—` (em dash) rather than `NaN` or `0 days`.
- All 27 `KEY_MAP` fields count toward completeness (accepted trade-off: naturally-optional fields like `mobile`/`notifiedOther` will suppress the average below 100% even for well-maintained files — this is expected per requirements, not a bug).

## Out of Scope (deferred to later phases)

- Per-stage turnaround (referral→permit, permit→chemo) — not possible without new date columns (Phase decision: not doing schema changes now).
- Historical trend of these metrics over time — depends on Phase 3 (Snapshot History).
- Exposing bucket boundaries or the "required fields" list as user-configurable settings.

## Testing / Verification Plan

Manual, in-browser (no test framework in this project):

1. Upload a sample tracker `.xlsx` with a mix of: closed cases, open cases at various visit-date ages, cases with/without chemo dates, cases with missing fields.
2. Manually compute expected values for all 6 metrics on a 3-5 patient sample; compare against rendered KPI values.
3. Click each of the 6 new cards; verify Master Registry tab opens with the correct quick filter applied and the row count matches the KPI card's displayed count.
4. Reload the page (data from `localStorage` cache) and confirm the KPIs render identically without re-uploading.
5. Toggle dark/light theme; confirm the new cards render correctly in both (they reuse existing classes, so this should be automatic).
