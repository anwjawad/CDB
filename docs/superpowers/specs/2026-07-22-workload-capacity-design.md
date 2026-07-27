# Phase 2: Workload & Capacity — Coordinator Workload, My Patients Link, Clinic Load Balance

## Context

Second phase of the OncoCoord v3 dashboard roadmap (Phase 1 — Operational KPIs — is complete). This phase adds a new "Workload & Capacity" tab surfacing how patient caseload is distributed across coordinators and clinics, computed client-side from the existing `patientsData` array. No Excel schema changes.

Builds directly on Phase 1's `isClosedCase(pat)` helper (`dashboard.js`) to exclude closed/completed files from workload counts, matching that phase's precedent.

**Data constraint:** the Excel tracker has no formal coordinator-to-clinic roster (no field says "Nurse X is assigned to Clinic Y"). The only available signal is which coordinator names actually appear on patient rows for a given clinic. Per user decision, "Clinic Load Balance" is built on this data-derived proxy, not a true staffing assignment — this is stated explicitly in the UI copy (see below) so it isn't mistaken for an official roster.

## Goals

1. **Coordinator Workload** — total active (non-closed) patient count per coordinator, sorted busiest-first.
2. **My Patients** — clicking a coordinator's row filters Master Registry to that coordinator (reuses the existing `#filter-coordinator` dropdown, not a new filter mechanism).
3. **Clinic Load Balance** — per clinic: active patient count, distinct coordinator count (data-derived), and average load per coordinator. Clicking a clinic's row filters Master Registry to that clinic (same mechanism, applied symmetrically).

## New Helper Functions (`dashboard.js`)

Placed alongside other patient-aggregate helpers (near `computeAvgCompleteness`/`computeAvgTurnaroundDays` from Phase 1):

```js
function computeCoordinatorWorkload() {
    const counts = {};
    patientsData.forEach(pat => {
        if (isClosedCase(pat)) return;
        const coordinator = getPatientVal(pat, 'coordinator');
        if (isEmptyLike(coordinator)) return;
        counts[coordinator] = (counts[coordinator] || 0) + 1;
    });
    return Object.entries(counts)
        .map(([coordinator, count]) => ({ coordinator, count }))
        .sort((a, b) => b.count - a.count);
}

function computeClinicLoadBalance() {
    const clinicData = {};
    patientsData.forEach(pat => {
        if (isClosedCase(pat)) return;
        const clinic = getPatientVal(pat, 'clinic');
        if (isEmptyLike(clinic)) return;
        const coordinator = getPatientVal(pat, 'coordinator');
        if (!clinicData[clinic]) clinicData[clinic] = { patientCount: 0, coordinators: new Set() };
        clinicData[clinic].patientCount++;
        if (!isEmptyLike(coordinator)) clinicData[clinic].coordinators.add(coordinator);
    });
    return Object.entries(clinicData)
        .map(([clinic, data]) => {
            const coordinatorCount = data.coordinators.size;
            const avgLoad = coordinatorCount > 0 ? Math.round((data.patientCount / coordinatorCount) * 10) / 10 : null;
            return { clinic, patientCount: data.patientCount, coordinatorCount, avgLoad };
        })
        .sort((a, b) => b.patientCount - a.patientCount);
}
```

Both are pure functions reading the global `patientsData`, `isClosedCase`, `isEmptyLike`, `getPatientVal` — no new global state.

## UI: New "Workload & Capacity" Tab

### Sidebar nav (`index.html`)

New `<button class="nav-item" data-tab="capacity" id="nav-capacity">` added to the "Issues" nav group (alongside Barriers, Smart Analytics, Workflow Follow-up), no badge — this is an informational/analytical tab, not an action queue, matching the precedent set by the badge-less Inpatient/Outpatient tabs.

### Tab content (`index.html`)

New `<section class="tab-pane" id="tab-capacity">` containing a `.dashboard-grid` with two `.dashboard-card.glass-card` panels (reuses the exact same classes as the Overview tab's two-chart layout — no new CSS needed):

**Panel 1 — Coordinator Workload**
```html
<table class="data-table">
    <thead><tr><th>Coordinator</th><th>Total Active Patients</th></tr></thead>
    <tbody id="coordinator-workload-table-body"></tbody>
</table>
```

**Panel 2 — Clinic Load Balance**
```html
<table class="data-table">
    <thead><tr><th>Clinic</th><th>Total Active Patients</th><th>Coordinators (data-derived)</th><th>Avg. Load / Coordinator</th></tr></thead>
    <tbody id="clinic-load-table-body"></tbody>
</table>
```

The panel header/subtitle text for Clinic Load Balance explicitly states the coordinator count is derived from who appears in the data, not an official assignment roster (per the data-constraint note above) — e.g. "Coordinators are counted from who appears in each clinic's records, not an official staffing roster."

Both tables reuse the existing `.data-table` styling and the existing `.table-empty-state` pattern (shown when a table has zero rows, matching every other tab's empty state).

## Wiring (`dashboard.js`)

- `renderWorkloadCapacityTab()`: calls `computeCoordinatorWorkload()` and `computeClinicLoadBalance()`, builds `<tr>` rows for each tbody (escaping all text via the existing `escapeHTML`), sorted as returned (already sorted desc by the compute functions). Each row gets a `click` listener that first clears every other Master Registry filter control (matching exactly what the existing `clear-filters-btn` handler already resets: search box, all 4 dropdowns, quick filters, column filters), then sets only the one relevant dropdown, then applies:

```js
function jumpToMasterFilteredBy(dropdownId, value) {
    document.getElementById('master-search-input').value = '';
    document.getElementById('filter-clinic').value = '';
    document.getElementById('filter-division').value = '';
    document.getElementById('filter-coordinator').value = '';
    document.getElementById('filter-status').value = '';
    setQuickFilters([]);
    clearActiveColumnFilters();
    document.getElementById(dropdownId).value = value;
    pagination.currentPage = 1;
    applyFilters();
    switchToMasterTab();
}
```

  - Coordinator row: `jumpToMasterFilteredBy('filter-coordinator', coordinator)`
  - Clinic row: `jumpToMasterFilteredBy('filter-clinic', clinic)`
- Registered in `setupTabSwitching()`'s existing `if/else if` chain (same place `followup`/`ncm`/`barriers`/etc. are dispatched): `else if (targetTab === 'capacity') { renderWorkloadCapacityTab(); }`.
- No new setup-on-load function is needed beyond this — row click listeners are (re)attached each time `renderWorkloadCapacityTab()` runs (same pattern `renderBarriersTab`/`renderFollowupTab` already use: rebuild rows + listeners together on every render).

## Edge Cases

- Coordinator or clinic value empty/blank on a patient row → that patient is excluded from the respective table's aggregation (can't route a click to an empty filter value).
- A clinic where every patient's coordinator field is blank → `coordinatorCount` is `0`, `avgLoad` is `null`, displayed as "—" (not `0` or `Infinity`).
- Zero eligible (non-closed) patients at all → both tables show the existing `.table-empty-state` markup, consistent with every other tab in the app.
- Coordinator/clinic names differing only in whitespace or case are NOT normalized/merged in this phase (matches how `filter-coordinator`/`filter-clinic` dropdowns already treat raw values elsewhere in the app — out of scope to introduce fuzzy grouping here).

## Out of Scope (deferred)

- True clinic ↔ coordinator staffing roster (would require a new "Lists" sheet column or new tracker field — a data/process change outside this phase).
- Per-coordinator breakdown by urgency/action-needed (user explicitly chose the simple total-count version for this phase).
- Historical workload trend over time (depends on the not-yet-built Phase 3, Snapshot History).

## Testing / Verification Plan

Manual, in-browser (no test framework in this project), following the same approach used for Phase 1:

1. Load a tracker with a mix of: multiple coordinators per clinic, at least one clinic with a blank coordinator on some rows, at least one closed/completed case that should be excluded from both tables.
2. Manually compute expected coordinator and clinic aggregates for a 3-5 patient sample; compare against the rendered tables.
3. Click a coordinator row; confirm Master Registry opens filtered to exactly that coordinator (row count matches the table's displayed count) and other filters are cleared.
4. Click a clinic row; confirm the same, filtered by clinic.
5. Confirm both tables render correctly in dark and light theme (reused classes, should be automatic).
6. Confirm the empty-state renders correctly if all loaded patients are closed/completed (temporarily test with a small dataset where every row is closed).
