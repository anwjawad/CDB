# Workload & Capacity (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Workload & Capacity" tab to the OncoCoord v3 dashboard showing per-coordinator patient load and per-clinic load balance, with click-through to a pre-filtered Master Registry.

**Architecture:** Two pure aggregation functions added to `dashboard.js` (`computeCoordinatorWorkload`, `computeClinicLoadBalance`), a new tab-pane in `index.html` with two stacked tables reusing the existing `.table-container`/`.data-table` classes (zero new CSS), and a render function that builds table rows with click handlers reusing the existing Master Registry filter dropdowns. Follows the exact same file-organization pattern as Phase 1 (Operational KPIs).

**Tech Stack:** Vanilla JS (ES6+), no framework, no bundler, no test framework — verification via browser DevTools console (pure functions are globally callable) plus a manual browser walkthrough.

**Spec:** `docs/superpowers/specs/2026-07-22-workload-capacity-design.md`

**No git repo in this project.** Do not run `git init`, `git add`, or `git commit` at any point in this plan.

**PHI caution for whoever executes Task 6 (manual verification):** this app is a real oncology coordination tool. If the browser used for testing already has real, cached patient data in `localStorage` (key `dashboard_static_data`), do NOT screenshot or reproduce individual patient names/details — verify using only aggregate numbers (counts, table row counts) read via the DevTools console or accessibility tree, never full-page screenshots showing patient rows. If synthetic test data is needed and the browser already has real cached data, ask the user before overwriting `localStorage`, since Phase 1's execution found this exact situation.

---

### Task 1: Coordinator workload & clinic load aggregation helpers

**Files:**
- Modify: `dashboard.js:213-215` (insert between `computeAvgTurnaroundDays` and `hasActiveBarrier`)

- [ ] **Step 1: Add `computeCoordinatorWorkload` and `computeClinicLoadBalance`**

Find:

```js
    if (diffs.length === 0) return null;
    return Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10;
}

function hasActiveBarrier(pat) {
```

Replace with:

```js
    if (diffs.length === 0) return null;
    return Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10;
}

// --- Workload & Capacity: coordinator and clinic aggregation helpers ---
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

function hasActiveBarrier(pat) {
```

IMPORTANT: `function hasActiveBarrier(pat) {` appears exactly once in the file, right after `computeAvgTurnaroundDays` (added in Phase 1). Confirm you're at that spot, not some other location.

- [ ] **Step 2: Verify in browser console**

Open `index.html` in a browser (double-click it, or `python -m http.server 8080` then visit `http://localhost:8080`; if a port is busy, use a free port instead — check first with the equivalent of `netstat`/`lsof` for your OS, or just try the next port up). Open DevTools console and run:

```js
patientsData = [
    { "Patient Name": "A", "Clinic": "Onco A", "Coordinator/ Clinic Nurse Signature": "Nurse X", "Case Status": "Active" },
    { "Patient Name": "B", "Clinic": "Onco A", "Coordinator/ Clinic Nurse Signature": "Nurse X", "Case Status": "Active" },
    { "Patient Name": "C", "Clinic": "Onco A", "Coordinator/ Clinic Nurse Signature": "Nurse Y", "Case Status": "Active" },
    { "Patient Name": "D", "Clinic": "Onco B", "Coordinator/ Clinic Nurse Signature": "Nurse Z", "Case Status": "Active" },
    { "Patient Name": "E", "Clinic": "Onco B", "Coordinator/ Clinic Nurse Signature": "", "Case Status": "Active" },
    { "Patient Name": "F", "Clinic": "Onco A", "Coordinator/ Clinic Nurse Signature": "Nurse X", "Case Status": "Closed" }
];
computeCoordinatorWorkload()
// expect [{ coordinator: "Nurse X", count: 2 }, { coordinator: "Nurse Y", count: 1 }, { coordinator: "Nurse Z", count: 1 }] in some order among ties, "Nurse X" first since count 2 > 1
computeClinicLoadBalance()
// expect Onco A: patientCount 3 (A,B,C — F excluded, closed), coordinatorCount 2 (Nurse X, Nurse Y), avgLoad 1.5
// expect Onco B: patientCount 2 (D,E), coordinatorCount 1 (Nurse Z — E's blank coordinator not counted), avgLoad 2
// Reload the page afterward to restore real data (or re-navigate if using the browser-preview tooling).
```

Note: if no browser/JS runtime is available, verify by manual code trace using the exact test data above — trace `isClosedCase`, `isEmptyLike`, `getPatientVal` (all pre-existing) against each of the 6 records by hand.

## Context

This is Task 1 of 6. `isClosedCase`, `isEmptyLike`, `getPatientVal`, and the global `patientsData` are pre-existing (the first three from Phase 1 / the original codebase). These two new functions will be called by Task 4's `renderWorkloadCapacityTab()` — keep the exact names and return shapes (`{coordinator, count}` array and `{clinic, patientCount, coordinatorCount, avgLoad}` array), later tasks depend on them by name and by field name.

## Before You Begin

If anything is unclear, ask now. Otherwise proceed.

## Your Job

1. Read the file first to confirm the "find" block matches exactly.
2. Make the edit exactly as specified.
3. Verify per Step 2.
4. Do NOT run git commands.
5. Self-review (see below).
6. Report back.

## Self-Review

- Are both functions present with EXACTLY the specified bodies?
- Do they return the exact field names later tasks depend on (`coordinator`, `count`, `clinic`, `patientCount`, `coordinatorCount`, `avgLoad`)?
- Did you avoid touching `hasActiveBarrier` or anything else?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 2: Sidebar navigation item

**Files:**
- Modify: `index.html:83-88` (Issues nav group)

- [ ] **Step 1: Add the "Workload & Capacity" nav button**

Find:

```html
                    <button class="nav-item" data-tab="workflow" id="nav-workflow">
                        <i class="fa-solid fa-diagram-next"></i>
                        <span>Workflow Follow-up</span>
                        <span class="badge badge-danger" id="badge-workflow">0</span>
                    </button>
                </div>
                <div class="nav-group">
                    <span class="nav-group-label">System</span>
```

Replace with:

```html
                    <button class="nav-item" data-tab="workflow" id="nav-workflow">
                        <i class="fa-solid fa-diagram-next"></i>
                        <span>Workflow Follow-up</span>
                        <span class="badge badge-danger" id="badge-workflow">0</span>
                    </button>
                    <button class="nav-item" data-tab="capacity" id="nav-capacity">
                        <i class="fa-solid fa-scale-balanced"></i>
                        <span>Workload & Capacity</span>
                    </button>
                </div>
                <div class="nav-group">
                    <span class="nav-group-label">System</span>
```

IMPORTANT: this exact block (`workflow` nav button immediately followed by the "System" nav group start) appears only ONCE in the file. Confirm it before editing. Note the new "Workload & Capacity" button intentionally has NO badge `<span>` — unlike Barriers/Analytics/Workflow, this is an informational tab, not an action queue (matches the badge-less Inpatient/Outpatient nav buttons elsewhere in the same sidebar).

- [ ] **Step 2: Verify**

If you have a browser tool: open/reload `index.html`, confirm a new "Workload & Capacity" sidebar item appears at the bottom of the "Issues" group, below "Workflow Follow-up". Clicking it won't do anything useful yet (its tab-pane doesn't exist until Task 3, and its render function doesn't exist until Task 4) — that's expected at this point; just confirm the button itself renders without breaking the sidebar layout.

If no browser tool: verify by reading the HTML — confirm well-formed markup (button opens/closes correctly, `data-tab="capacity"` attribute present, `id="nav-capacity"` unique in the file).

## Context

This is Task 2 of 6, the first UI task. `data-tab="capacity"` must match exactly what Task 3's tab-pane `id` and Task 5's `setupTabSwitching()` branch will use — these are three separate files/tasks that must agree on the string `"capacity"` verbatim.

## Before You Begin

If anything is unclear, ask now. Otherwise proceed.

## Your Job

1. Read the file first to confirm the "find" block matches exactly.
2. Make the edit exactly as specified.
3. Verify per Step 2.
4. Do NOT run git commands.
5. Self-review (see below).
6. Report back.

## Self-Review

- Is the new button present with EXACTLY the specified markup, in the correct position (after Workflow Follow-up, still inside the "Issues" `.nav-group`, before the "System" group starts)?
- Does it use `data-tab="capacity"` and `id="nav-capacity"` exactly?
- Did you avoid adding a badge span (intentionally omitted)?
- Did you avoid touching anything else in this large file?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 3: Tab-pane markup with two tables

**Files:**
- Modify: `index.html` (between the closing of `#tab-workflow` and the start of `#tab-settings`)

- [ ] **Step 1: Insert the new tab-pane**

Find (this is the end of the Workflow Follow-up tab-pane and the start of the Settings tab section comment — verified exact text, lines 945-954 as of this plan's writing):

```html
                                <span class="akpi-view-hint">View patients →</span>
                            </div>
                        </div>

                    </div>

                </section>

                <!-- 10. SETTINGS TAB -->
                <section class="tab-pane" id="tab-settings">
```

If line numbers have drifted but this exact text is still present verbatim, that's fine — match on the text, not the line numbers. If the text itself doesn't match at all (e.g. the file changed unexpectedly), instead locate it structurally: find `<section class="tab-pane" id="tab-workflow">`, find ITS matching closing `</section>` (the workflow tab-pane's own closing tag, not any nested `</div>`), and confirm the very next non-blank line after that `</section>` is the HTML comment `<!-- 10. SETTINGS TAB -->` followed by `<section class="tab-pane" id="tab-settings">`. Use that closing `</section>` + comment pair as your insertion anchor in that fallback case.

Insert this new section between the workflow tab-pane's closing `</section>` and the `<!-- 10. SETTINGS TAB -->` comment:

```html
                <!-- 11. WORKLOAD & CAPACITY TAB -->
                <section class="tab-pane" id="tab-capacity">
                    <div class="table-container glass-card">
                        <div class="card-header border-none padding-bottom-none">
                            <h3>Coordinator Workload</h3>
                        </div>
                        <div class="responsive-table-wrapper margin-top-20">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Coordinator</th>
                                        <th>Total Active Patients</th>
                                    </tr>
                                </thead>
                                <tbody id="coordinator-workload-table-body">
                                    <!-- Dynamic content -->
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="table-container glass-card margin-top-20">
                        <div class="card-header border-none padding-bottom-none">
                            <h3>Clinic Load Balance</h3>
                        </div>
                        <p class="settings-desc margin-top-15">Coordinators are counted from who appears in each clinic's records, not an official staffing roster.</p>
                        <div class="responsive-table-wrapper margin-top-20">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Clinic</th>
                                        <th>Total Active Patients</th>
                                        <th>Coordinators (data-derived)</th>
                                        <th>Avg. Load / Coordinator</th>
                                    </tr>
                                </thead>
                                <tbody id="clinic-load-table-body">
                                    <!-- Dynamic content -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

```

So the final result reads: `</section>` (workflow's close) → blank line → the new `<!-- 11. WORKLOAD & CAPACITY TAB -->` section (as above) → `<!-- 10. SETTINGS TAB -->` comment → `<section class="tab-pane" id="tab-settings">`. (The "11." numbering is cosmetic/for-humans only, matching this file's existing numbered-HTML-comment convention — it doesn't need to be sequential with "10." Settings; leave Settings' own "10." label untouched.)

- [ ] **Step 2: Verify**

If you have a browser tool: reload, click the "Workload & Capacity" sidebar item (added in Task 2), confirm the new tab-pane becomes visible showing two empty-looking tables with headers "Coordinator Workload" and "Clinic Load Balance" (no rows yet — that's expected, Task 4 hasn't wired the render function yet, so `<tbody>` stays empty with just the `<!-- Dynamic content -->` HTML comment, meaning literally zero visible rows and zero visible "empty state" message at this point, which is fine).

If no browser tool: verify by reading the HTML — confirm the new `<section>` is well-formed (opens/closes correctly), confirm `id="tab-capacity"` matches Task 2's `data-tab="capacity"` and will match Task 5's upcoming JS branch, confirm `id="coordinator-workload-table-body"` and `id="clinic-load-table-body"` are both unique in the file (these exact ids are required by Task 4).

## Context

This is Task 3 of 6. This entirely reuses existing CSS classes (`table-container`, `glass-card`, `card-header`, `border-none`, `padding-bottom-none`, `margin-top-20`, `margin-top-15`, `responsive-table-wrapper`, `data-table`, `settings-desc`) already defined in `styles.css` and used by other tabs (e.g. the Inpatient tab uses the same `card-header border-none padding-bottom-none` pattern; the Settings tab uses `settings-desc`) — **no new CSS is needed for this task.**

## Before You Begin

If anything is unclear, ask now. Otherwise proceed.

## Your Job

1. Read the file first to locate the workflow tab-pane's closing `</section>` and the Settings tab-pane's opening, confirming the insertion point.
2. Make the edit exactly as specified.
3. Verify per Step 2.
4. Do NOT run git commands.
5. Self-review (see below).
6. Report back.

## Self-Review

- Is the new `<section id="tab-capacity">` present, well-formed, and positioned between the workflow tab-pane and the settings tab-pane?
- Do `id="coordinator-workload-table-body"` and `id="clinic-load-table-body"` exist with EXACTLY that spelling (Task 4 depends on them by name)?
- Did you avoid modifying the Workflow or Settings tab-panes themselves?
- Did you avoid introducing any new CSS or `<style>` block?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 4: Render function and filter jump helper

**Files:**
- Modify: `dashboard.js:4296-4307` (insert after `renderWorkflowTab`)

- [ ] **Step 1: Add `jumpToMasterFilteredBy` and `renderWorkloadCapacityTab`**

Find:

```js
function renderWorkflowTab() {
    const counts = computeWorkflowCounts();
    workflowResults = counts;
    for (const id of 'ABCDEFGHIJKL') {
        const el = document.getElementById(`wkpi-val-${id}`);
        if (el) el.innerText = (counts[id] || []).length;
    }
}

// --- Modal ---
```

Replace with:

```js
function renderWorkflowTab() {
    const counts = computeWorkflowCounts();
    workflowResults = counts;
    for (const id of 'ABCDEFGHIJKL') {
        const el = document.getElementById(`wkpi-val-${id}`);
        if (el) el.innerText = (counts[id] || []).length;
    }
}

// --- Workload & Capacity Tab ---

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

function renderWorkloadCapacityTab() {
    const coordinatorBody = document.getElementById('coordinator-workload-table-body');
    const clinicBody = document.getElementById('clinic-load-table-body');
    if (!coordinatorBody || !clinicBody) return;

    const coordinatorWorkload = computeCoordinatorWorkload();
    coordinatorBody.innerHTML = '';
    if (coordinatorWorkload.length === 0) {
        coordinatorBody.innerHTML = `<tr><td colspan="2"><div class="table-empty-state"><i class="fa-solid fa-users"></i><h4>No active coordinator workload</h4><p>No active (non-closed) patients have a coordinator assigned yet.</p></div></td></tr>`;
    } else {
        coordinatorWorkload.forEach(entry => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${escapeHTML(entry.coordinator)}</td><td>${entry.count}</td>`;
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => jumpToMasterFilteredBy('filter-coordinator', entry.coordinator));
            coordinatorBody.appendChild(row);
        });
    }

    const clinicLoadBalance = computeClinicLoadBalance();
    clinicBody.innerHTML = '';
    if (clinicLoadBalance.length === 0) {
        clinicBody.innerHTML = `<tr><td colspan="4"><div class="table-empty-state"><i class="fa-solid fa-hospital"></i><h4>No active clinic load data</h4><p>No active (non-closed) patients have a clinic assigned yet.</p></div></td></tr>`;
    } else {
        clinicLoadBalance.forEach(entry => {
            const row = document.createElement('tr');
            const avgLoadDisplay = entry.avgLoad === null ? '—' : entry.avgLoad;
            row.innerHTML = `<td>${escapeHTML(entry.clinic)}</td><td>${entry.patientCount}</td><td>${entry.coordinatorCount}</td><td>${avgLoadDisplay}</td>`;
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => jumpToMasterFilteredBy('filter-clinic', entry.clinic));
            clinicBody.appendChild(row);
        });
    }
}

// --- Modal ---
```

IMPORTANT: `function renderWorkflowTab() {` followed shortly by `// --- Modal ---` appears exactly once in the file. Confirm this before editing.

- [ ] **Step 2: Verify in browser console**

```js
patientsData = [
    { "Patient Name": "A", "Clinic": "Onco A", "Coordinator/ Clinic Nurse Signature": "Nurse X", "Case Status": "Active" },
    { "Patient Name": "B", "Clinic": "Onco A", "Coordinator/ Clinic Nurse Signature": "Nurse X", "Case Status": "Active" },
    { "Patient Name": "C", "Clinic": "Onco B", "Coordinator/ Clinic Nurse Signature": "Nurse Z", "Case Status": "Active" }
];
renderWorkloadCapacityTab();
document.getElementById('coordinator-workload-table-body').children.length   // expect 2 (Nurse X row, Nurse Z row)
document.getElementById('clinic-load-table-body').children.length            // expect 2 (Onco A row, Onco B row)
```

Then, if a browser tool is available: manually click the "Workload & Capacity" nav item (from Task 2), confirm the two tables now show these 2 rows each with real numbers instead of being empty. Click the "Nurse X" row; confirm the app switches to Master Registry with exactly 2 matching records and the Coordinator dropdown shows "Nurse X" selected.

Note: `escapeHTML`, `switchToMasterTab`, `setQuickFilters`, `clearActiveColumnFilters`, `pagination`, `applyFilters` are all pre-existing globals in this file (from before this feature and from Phase 1) — do not modify any of them, just call them.

## Context

This is Task 4 of 6. It depends on Task 1's `computeCoordinatorWorkload`/`computeClinicLoadBalance` and Task 3's element ids (`coordinator-workload-table-body`, `clinic-load-table-body`) already existing. It does NOT yet get called automatically anywhere — that's Task 5's job (wiring it into tab-switching). At the end of this task, the render function exists and works when called manually, but the app doesn't call it on its own yet.

## Before You Begin

If anything is unclear, ask now. Otherwise proceed.

## Your Job

1. Read the file first to confirm the "find" block matches exactly.
2. Make the edit exactly as specified.
3. Verify per Step 2.
4. Do NOT run git commands.
5. Self-review (see below).
6. Report back.

## Self-Review

- Are both functions present with EXACTLY the specified bodies, in the correct location (right after `renderWorkflowTab`, right before `// --- Modal ---`)?
- Does `jumpToMasterFilteredBy` clear all 5 other filter controls (search, clinic, division, coordinator, status) plus quick filters and column filters, before setting the one relevant dropdown?
- Do the empty-state messages use `colspan="2"` for the coordinator table and `colspan="4"` for the clinic table (matching each table's actual column count)?
- Is every row's text content passed through `escapeHTML`?
- Did you avoid touching `renderWorkflowTab` itself or anything else in the file?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 5: Wire the new tab into navigation and filter-clearing

**Files:**
- Modify: `dashboard.js` (inside `setupTabSwitching`)
- Modify: `dashboard.js` (inside the `clear-filters-btn` click handler)

- [ ] **Step 1: Register the tab in `setupTabSwitching`**

Find:

```js
            } else if (targetTab === 'analytics') {
                renderAnalyticsTab();
            } else if (targetTab === 'workflow') {
                renderWorkflowTab();
            }
        });
    });
}
```

Replace with:

```js
            } else if (targetTab === 'analytics') {
                renderAnalyticsTab();
            } else if (targetTab === 'workflow') {
                renderWorkflowTab();
            } else if (targetTab === 'capacity') {
                renderWorkloadCapacityTab();
            }
        });
    });
}
```

IMPORTANT: this `if/else if` chain (ending in `renderWorkflowTab();` then the chain's closing `}`) appears exactly once in the file — it's inside `setupTabSwitching()`. Confirm before editing.

- [ ] **Step 2: Refresh the tab when "Clear Filters" is clicked**

Find:

```js
            renderBarriersTab();
            renderAnalyticsTab();
            renderWorkflowTab();
            
            showToast("Filters cleared and reset", "info");
```

Replace with:

```js
            renderBarriersTab();
            renderAnalyticsTab();
            renderWorkflowTab();
            renderWorkloadCapacityTab();
            
            showToast("Filters cleared and reset", "info");
```

- [ ] **Step 3: Verify**

If a browser tool is available: reload the app, load or keep whatever patient data is present, click "Workload & Capacity" in the sidebar — confirm the two tables now populate automatically (no manual console call needed, unlike Task 4's verification). Click a coordinator row, confirm it jumps to Master Registry filtered correctly. Go back to Workload & Capacity, click a clinic row, confirm the same. Then go to Master Registry, apply some filter, click "Clear Filters", switch to the Workload & Capacity tab — confirm it still shows correct (non-stale) numbers.

If no browser tool: verify by reading the two edited locations — confirm `renderWorkloadCapacityTab();` appears in both places specified, with correct syntax (semicolon, correct indentation matching surrounding lines), and confirm you did not duplicate or remove any pre-existing branch/call in either block.

## Context

This is Task 5 of 6, the final wiring task. After this, the tab is fully functional exactly like every other tab in the app — clicking it in the sidebar triggers its render function automatically (via `setupTabSwitching`), and it stays in sync with the global "Clear Filters" action (via the second edit), matching the precedent every other tab (`followup`, `ncm`, `inpatient`, `outpatient`, `barriers`, `analytics`, `workflow`) already follows in both of these exact two places.

## Before You Begin

If anything is unclear, ask now. Otherwise proceed.

## Your Job

1. Read the file first to confirm both "find" blocks match exactly (there are two separate edits).
2. Make both edits exactly as specified.
3. Verify per Step 3.
4. Do NOT run git commands.
5. Self-review (see below).
6. Report back.

## Self-Review

- Is `renderWorkloadCapacityTab();` called in `setupTabSwitching()`'s `else if (targetTab === 'capacity')` branch, in the correct position (after the `workflow` branch, before the chain's closing `}`)?
- Is `renderWorkloadCapacityTab();` also called in the `clear-filters-btn` handler, right after the existing `renderWorkflowTab();` call?
- Did you avoid touching any other branch or any other part of either function?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 6: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Full manual walkthrough**

With patient data loaded (real or synthetic — **if real cached data is already present in the test browser's `localStorage`, use it read-only and do not screenshot individual patient rows/names; verify with aggregate counts only**, per the PHI caution at the top of this plan):

1. Click "Workload & Capacity" in the sidebar. Confirm both tables render with plausible, non-empty data (assuming the loaded dataset has active, non-closed patients with clinic/coordinator values).
2. Cross-check: open DevTools console and run `computeCoordinatorWorkload()` / `computeClinicLoadBalance()` directly; confirm the array lengths and values match what's rendered in the two tables (same approach used successfully in Phase 1's Task 10).
3. Click a coordinator row; confirm Master Registry opens filtered to exactly that coordinator, with the "Matching records" count equal to that row's displayed count, and confirm the other filter dropdowns (Clinic, Division, Status) are empty/reset.
4. Click a clinic row; confirm the same, filtered by clinic instead.
5. Toggle dark/light theme (sidebar toggle button); confirm both tables and their headers render correctly in both themes (should be automatic since only pre-existing classes are reused).
6. If the loaded dataset has at least one closed/completed case, confirm it does NOT appear in either table's aggregation (spot-check by comparing `patientsData.length` vs. the sum of counts across both tables' rows — the sum should be less than or equal to `patientsData.length` whenever any closed cases or blank clinic/coordinator values exist).
7. Open DevTools console, confirm no new errors or warnings appear that weren't present before this change.

- [ ] **Step 2: Done**

If all checks in Step 1 pass, Phase 2 (Workload & Capacity) is complete.
