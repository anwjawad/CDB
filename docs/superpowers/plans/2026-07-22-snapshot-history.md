# Snapshot History (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight, aggregate-only daily snapshot history to the OncoCoord v3 dashboard, with a trend chart and "since last upload" delta summary shown in the Overview tab.

**Architecture:** A new, separate `localStorage` key (`dashboard_snapshot_history`) holds a small JSON array — one entry per calendar day, each just 7 numbers (no per-patient data). A new `recordSnapshot()` call is added to the existing upload pipeline (`applyDashboardData`, upload-only, never on cache-only page loads). Two new render functions read the history: a delta-summary paragraph and a 5th Chart.js line chart added to the *existing* `renderCharts()` function (so it inherits the existing theme/redraw lifecycle for free). This is the first phase to change the storage model itself — extra care is taken with quota-failure handling (reusing existing `writeStorage()` behavior) and with local-date-key correctness (the Phase 1 lesson: never use `toISOString()` for a "day" key, it shifts by UTC offset).

**Tech Stack:** Vanilla JS (ES6+), Chart.js (already a dependency), no framework, no bundler, no test framework — verification via browser DevTools console plus a manual browser walkthrough.

**Spec:** `docs/superpowers/specs/2026-07-22-snapshot-history-design.md`

**No git repo in this project.** Do not run `git init`, `git add`, or `git commit` at any point in this plan.

**PHI caution for whoever executes Task 7 (manual verification):** this app is a real oncology coordination tool and the test browser may have real cached patient data. Snapshot history itself contains ONLY aggregate numbers (no patient names/ids), so it is safe to screenshot the Trends section specifically. Do NOT screenshot the Master Registry or any other tab showing individual patient rows.

---

### Task 1: Storage key and core snapshot functions

**Files:**
- Modify: `dashboard.js:14-17` (`STORAGE_KEYS`)
- Modify: `dashboard.js:229-249` (insert between `computeClinicLoadBalance` and `hasActiveBarrier`)

- [ ] **Step 1: Add the new storage key**

Find:

```js
const STORAGE_KEYS = Object.freeze({
    theme: "theme",
    data: "dashboard_static_data"
});
```

Replace with:

```js
const STORAGE_KEYS = Object.freeze({
    theme: "theme",
    data: "dashboard_static_data",
    snapshotHistory: "dashboard_snapshot_history"
});
```

- [ ] **Step 2: Add `getTodayDateKey`, `readSnapshotHistory`, `computeSnapshotSummary`, `recordSnapshot`**

Find:

```js
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

Replace with:

```js
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

// --- Snapshot History (Phase 3) ---
function getTodayDateKey() {
    const dt = new Date();
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function readSnapshotHistory() {
    const raw = readStorage(STORAGE_KEYS.snapshotHistory);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn("Unable to parse snapshot history, resetting.", err);
        return [];
    }
}

function computeSnapshotSummary() {
    let active = 0, pendingReferrals = 0, ncmCount = 0, activeBarriers = 0;
    patientsData.forEach(pat => {
        const status = normalizeValue(getPatientVal(pat, 'status'));
        if (status === 'active' || status === 'نشط' || status === 'مستمر') active++;
        if (isPendingValue(getPatientVal(pat, 'treatmentReferralStatus'))) pendingReferrals++;
        if (isYesValue(getPatientVal(pat, 'ncm'))) ncmCount++;
        if (hasActiveBarrier(pat)) activeBarriers++;
    });
    return {
        total: patientsData.length,
        active,
        pendingReferrals,
        ncmCount,
        activeBarriers,
        dataCompleteness: computeAvgCompleteness(),
        avgTurnaround: computeAvgTurnaroundDays()
    };
}

function recordSnapshot() {
    const history = readSnapshotHistory();
    const todayKey = getTodayDateKey();
    const newEntry = {
        date: todayKey,
        timestamp: new Date().toLocaleString("en-US", { hour12: true }),
        summary: computeSnapshotSummary()
    };

    const existingIdx = history.findIndex(e => e.date === todayKey);
    if (existingIdx !== -1) {
        history[existingIdx] = newEntry;
    } else {
        history.push(newEntry);
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    const trimmed = history.filter(e => e.date >= cutoffKey).sort((a, b) => a.date.localeCompare(b.date));

    writeStorage(STORAGE_KEYS.snapshotHistory, JSON.stringify(trimmed));
}

function hasActiveBarrier(pat) {
```

IMPORTANT: `function hasActiveBarrier(pat) {` appears exactly once in the file, right after `computeClinicLoadBalance` (added in Phase 2). Confirm you're at that spot before editing.

- [ ] **Step 3: Verify in browser console**

If a browser/JS runtime is available: open `index.html` (double-click, or `python -m http.server 8080`/another free port). In DevTools console:

```js
// Isolate from any real cached data during this test — read it back via readSnapshotHistory() only, never write real data over it.
patientsData = [
    { "Patient Name": "A", "Case Status": "Active", "Current Barrier/Issue": "Transport issue", "Treatment Referral Status": "Pending" },
    { "Patient Name": "B", "Case Status": "Active", "New Cases Meeting": "Yes" }
];
const summary = computeSnapshotSummary();
summary
// expect { total: 2, active: 2, pendingReferrals: 1, ncmCount: 1, activeBarriers: 1, dataCompleteness: <number>, avgTurnaround: null }

getTodayDateKey()
// expect today's LOCAL date as "YYYY-MM-DD" (compare against your system clock's local date, not UTC — this matters if you're testing near midnight)

readSnapshotHistory()
// expect [] if this is a fresh browser profile, or an array if real history already exists — either way, must not throw
```

Then, to verify `recordSnapshot()`'s same-day dedup and 90-day pruning logic in isolation (this is safe to run even against a browser with real history, since `recordSnapshot()` only ever touches today's entry and prunes by date, never wipes unrelated real data — but if you'd rather not touch real state at all, do this in a private/incognito window instead):

```js
// Same-day dedup: calling recordSnapshot() twice in a row must not create two entries for today.
const beforeCount = readSnapshotHistory().length;
recordSnapshot();
const afterFirstCall = readSnapshotHistory().length;
recordSnapshot();
const afterSecondCall = readSnapshotHistory().length;
afterFirstCall === afterSecondCall
// expect true (second call overwrote today's entry, did not add a new one)
readSnapshotHistory().filter(e => e.date === getTodayDateKey()).length
// expect exactly 1

// 90-day pruning: seed a fake old entry beyond the retention window, confirm recordSnapshot() prunes it.
const history = readSnapshotHistory();
history.push({ date: "2020-01-01", timestamp: "old", summary: { total: 1, active: 1, pendingReferrals: 0, ncmCount: 0, activeBarriers: 0, dataCompleteness: 0, avgTurnaround: null } });
writeStorage(STORAGE_KEYS.snapshotHistory, JSON.stringify(history));
recordSnapshot();
readSnapshotHistory().some(e => e.date === "2020-01-01")
// expect false (the 2020 entry was pruned as older than 90 days)
```

Reload the page afterward if you want to discard these test writes (a reload won't undo `localStorage` changes by itself, but confirms the app still loads correctly with this test data present — if you need to fully restore prior real state and are concerned about it, note that in your report rather than guessing).

Do NOT call `recordSnapshot()` before this point in a way that's coupled to the upload flow (it would write real `localStorage` state prematurely, before the rest of the feature is wired up) — the direct console calls above are fine since they test the function in isolation; the full upload-triggered flow is covered in Task 2's verification.

If no browser/JS runtime is available, verify by manual code trace using the exact test data above.

## Context

This is Task 1 of 7. It only adds pure/storage-reading functions — nothing calls `recordSnapshot()` yet (that's Task 2), and nothing renders anything from this data yet (Tasks 5-6). `readStorage`, `writeStorage`, `normalizeValue`, `getPatientVal`, `isPendingValue`, `isYesValue`, `hasActiveBarrier`, `computeAvgCompleteness`, `computeAvgTurnaroundDays` are all pre-existing (from the original codebase and Phases 1-2) — do not modify any of them.

## Before You Begin

If anything is unclear, ask now. Otherwise proceed.

## Your Job

1. Read the file first to confirm both "find" blocks match exactly.
2. Make both edits exactly as specified.
3. Verify per Step 3.
4. Do NOT run git commands.
5. Self-review (see below).
6. Report back.

## Self-Review

- Is `STORAGE_KEYS.snapshotHistory` added with exactly the value `"dashboard_snapshot_history"`, without disturbing the existing `theme`/`data` keys?
- Are all 4 new functions present with EXACTLY the specified bodies, in the correct location?
- Does `getTodayDateKey()` use local `Date` methods (`getFullYear`/`getMonth`/`getDate`), NOT `toISOString()` (which is UTC and would produce a wrong date near midnight in some timezones)?
- Did you avoid touching `computeClinicLoadBalance` or `hasActiveBarrier`?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 2: Wire `recordSnapshot()` into the upload pipeline

**Files:**
- Modify: `dashboard.js:1017-1048` (`applyDashboardData`)

- [ ] **Step 1: Call `recordSnapshot()` right after the main data is cached**

Find:

```js
    writeStorage(STORAGE_KEYS.data, JSON.stringify(cachedData));

    const initialOverlay = document.getElementById("initial-load-overlay");
    if (initialOverlay) initialOverlay.classList.add("hidden");

    populateFilterOptions();
```

Replace with:

```js
    writeStorage(STORAGE_KEYS.data, JSON.stringify(cachedData));
    recordSnapshot();

    const initialOverlay = document.getElementById("initial-load-overlay");
    if (initialOverlay) initialOverlay.classList.add("hidden");

    populateFilterOptions();
```

IMPORTANT: `writeStorage(STORAGE_KEYS.data, JSON.stringify(cachedData));` appears exactly once in the file, inside `applyDashboardData`. Do NOT add a `recordSnapshot()` call inside `loadDashboardData()` (a different, pre-existing function that only re-reads the cache on page load) — snapshots must only be recorded on a real upload, per the approved spec. Confirm you are editing `applyDashboardData`, not `loadDashboardData`.

- [ ] **Step 2: Verify in browser console**

If a browser tool is available:
1. In the running app, check current history: `readSnapshotHistory()` — note the current length (call it N; likely `[]` on a fresh profile, or some entries if the browser has prior real usage — either is fine, just note it).
2. Upload any real or minimal-sample `.xlsx` tracker via the "Upload Excel File" button (must have a "Tracking sheet" with a header row containing "Patient Name" or "اسم المريض").
3. After the upload completes, run `readSnapshotHistory()` again — confirm the length is N (if today's date already had an entry) or N+1 (if this is the first upload of today), and confirm the newest/updated entry's `date` equals `getTodayDateKey()`'s current value, and its `summary.total` matches the number of patients just uploaded.
4. Reload the page (no new upload) — confirm `readSnapshotHistory()` still shows the same result as step 3 (proving `loadDashboardData()`, triggered by the reload, did NOT add another entry).

If no browser tool: verify by reading the edited function — confirm `recordSnapshot();` appears once, in `applyDashboardData` only, positioned right after the `writeStorage(STORAGE_KEYS.data, ...)` line and before `populateFilterOptions();`.

## Context

This is Task 2 of 7. `recordSnapshot` was added in Task 1. This task is the ONLY place that calls it — `applyDashboardData` runs exactly once per successful upload (called from `processUploadedExcel`), which is exactly the "record on upload, not on cache reload" behavior the spec requires.

## Before You Begin

If anything is unclear, ask now. Otherwise proceed.

## Your Job

1. Read the file first to confirm the "find" block matches exactly and that you're inside `applyDashboardData`.
2. Make the edit exactly as specified.
3. Verify per Step 2.
4. Do NOT run git commands.
5. Self-review (see below).
6. Report back.

## Self-Review

- Is `recordSnapshot();` called exactly once, inside `applyDashboardData`, in the correct position?
- Did you confirm `loadDashboardData()` (the cache-reload function) does NOT call `recordSnapshot()`?
- Did you avoid changing anything else in `applyDashboardData`?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 3: Extend "Clear Browser Cache" to also clear snapshot history

**Files:**
- Modify: `dashboard.js:984-994` (`setupResetCache`)

- [ ] **Step 1: Remove the snapshot history key too**

Find:

```js
function setupResetCache() {
    const resetCacheBtn = document.getElementById("reset-cache-btn");
    if (resetCacheBtn) {
        resetCacheBtn.addEventListener("click", () => {
            const confirmed = window.confirm("Clear all locally cached dashboard data from this browser?");
            if (!confirmed) return;
            removeStorage(STORAGE_KEYS.data);
            showToast("Cache cleared! Reloading dashboard...", "info");
            setTimeout(() => { window.location.reload(); }, 1000);
        });
    }
```

Replace with:

```js
function setupResetCache() {
    const resetCacheBtn = document.getElementById("reset-cache-btn");
    if (resetCacheBtn) {
        resetCacheBtn.addEventListener("click", () => {
            const confirmed = window.confirm("Clear all locally cached dashboard data from this browser?");
            if (!confirmed) return;
            removeStorage(STORAGE_KEYS.data);
            removeStorage(STORAGE_KEYS.snapshotHistory);
            showToast("Cache cleared! Reloading dashboard...", "info");
            setTimeout(() => { window.location.reload(); }, 1000);
        });
    }
```

- [ ] **Step 2: Verify**

If a browser tool is available: with some snapshot history present (from Task 2's testing), open Settings tab, click "Clear Browser Cache", confirm the browser `confirm()` dialog, and after the page reloads, run `readSnapshotHistory()` in the console — confirm it returns `[]`.

If no browser tool: verify by reading the edited handler — confirm `removeStorage(STORAGE_KEYS.snapshotHistory);` was added right after the existing `removeStorage(STORAGE_KEYS.data);` line, with nothing else changed.

## Context

This is Task 3 of 7. `removeStorage` is pre-existing (used the same way for `STORAGE_KEYS.data` already on the line right above). This ensures a full cache clear is actually full — otherwise a user resetting their data would still see old trend lines reappear after their next upload.

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

- Is `removeStorage(STORAGE_KEYS.snapshotHistory);` present, right after the existing `removeStorage(STORAGE_KEYS.data);` line?
- Did you avoid changing the confirm dialog text, the toast message, or the reload timeout?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 4: Trends section markup in the Overview tab

**Files:**
- Modify: `index.html:313-316` (end of `#operational-kpi-grid`, start of Charts & Insights)

- [ ] **Step 1: Insert the Trends section**

Find:

```html
                        </div>
                    </div>

                    <!-- Charts & Insights -->
                    <div class="dashboard-grid">
```

Replace with:

```html
                        </div>
                    </div>

                    <!-- Trends (Phase 3) -->
                    <div class="dashboard-section-header">
                        <h3>Trends (Last 90 Days)</h3>
                    </div>
                    <div class="dashboard-card glass-card">
                        <p id="trends-delta-summary" class="kpi-context"></p>
                        <div class="chart-container">
                            <canvas id="chart-trends" role="img" aria-label="Line chart: patient totals, barriers, and pending referrals over the last 90 days"></canvas>
                        </div>
                    </div>

                    <!-- Charts & Insights -->
                    <div class="dashboard-grid">
```

IMPORTANT: the text `</div>\n                    </div>\n\n                    <!-- Charts & Insights -->\n                    <div class="dashboard-grid">` should appear only ONCE in the file — it's the specific transition from the Phase 1 Operational KPIs grid to the pre-existing Charts section, both inside `#tab-overview`. If you find multiple superficially-similar `</div></div>` pairs elsewhere in this large file, use the `<!-- Charts & Insights -->` comment (which is unique) as your primary anchor, and confirm the two `</div>` closes immediately above it belong to `#operational-kpi-grid` (i.e. you're still inside `<section class="tab-pane active" id="tab-overview">`).

- [ ] **Step 2: Verify**

If a browser tool is available: reload, confirm on the Overview tab a new "Trends (Last 90 Days)" heading and an (empty, for now — Task 5-6 wire the content) card with a `<canvas>` appear between the Operational KPIs cards and the existing charts grid. No JS errors should appear (the canvas will just be blank at this point since nothing draws into it yet).

If no browser tool: verify by reading the HTML — confirm `id="trends-delta-summary"` and `id="chart-trends"` are each unique in the file (Tasks 5 and 6 depend on these exact ids), confirm the new markup sits inside `#tab-overview` between `#operational-kpi-grid` and the pre-existing charts `.dashboard-grid`.

## Context

This is Task 4 of 7, the only HTML task. Reuses `.dashboard-section-header` (Phase 1), `.dashboard-card`/`.glass-card`/`.chart-container` (pre-existing, used by the charts right below), and `.kpi-context` (pre-existing small-muted-text class, used elsewhere for KPI card subtitles) — **no new CSS needed.**

## Before You Begin

If anything is unclear, ask now. Otherwise proceed.

## Your Job

1. Read the file first to confirm the "find" block matches exactly and is inside `#tab-overview`.
2. Make the edit exactly as specified.
3. Verify per Step 2.
4. Do NOT run git commands.
5. Self-review (see below).
6. Report back.

## Self-Review

- Are `id="trends-delta-summary"` and `id="chart-trends"` present with EXACTLY that spelling, each unique in the file?
- Is the new section positioned between the Operational KPIs grid and the existing Charts & Insights grid, still inside `#tab-overview`?
- Did you avoid introducing any new CSS?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 5: Delta summary render function

**Files:**
- Modify: `dashboard.js:1352-1382` (`calculateKPIs`)

- [ ] **Step 1: Add `renderTrendsSummary()` and call it from `calculateKPIs()`**

Find:

```js
    updateMasterFunnel();
    updateTriageBanner(activeBarriers, missingChemo, pendingReferrals, ncmCount);
    renderOperationalKPIs();
}
```

Replace with:

```js
    updateMasterFunnel();
    updateTriageBanner(activeBarriers, missingChemo, pendingReferrals, ncmCount);
    renderOperationalKPIs();
    renderTrendsSummary();
}

function renderTrendsSummary() {
    const el = document.getElementById('trends-delta-summary');
    if (!el) return;

    const history = readSnapshotHistory();
    if (history.length === 0) {
        el.innerText = "No snapshot history yet — upload a tracker file to start tracking trends.";
        return;
    }
    if (history.length === 1) {
        el.innerText = `First recorded snapshot (${history[0].date}). Trends will appear after your next upload.`;
        return;
    }

    const latest = history[history.length - 1];
    const previous = history[history.length - 2];
    const diffTotal = latest.summary.total - previous.summary.total;
    const diffBarriers = latest.summary.activeBarriers - previous.summary.activeBarriers;
    const diffPending = latest.summary.pendingReferrals - previous.summary.pendingReferrals;

    const parts = [];
    if (diffTotal !== 0) parts.push(`${diffTotal > 0 ? '+' : ''}${diffTotal} patients`);
    if (diffBarriers !== 0) parts.push(`${diffBarriers > 0 ? '+' : ''}${diffBarriers} barriers`);
    if (diffPending !== 0) parts.push(`${diffPending > 0 ? '+' : ''}${diffPending} pending referrals`);

    if (parts.length === 0) {
        el.innerText = `Since last upload (${latest.date}): no change.`;
    } else {
        el.innerText = `Since last upload (${latest.date}): ${parts.join(', ')}.`;
    }
}
```

IMPORTANT: `renderOperationalKPIs();\n}` (the end of `calculateKPIs`, added in Phase 1) appears exactly once in the file. Confirm before editing.

- [ ] **Step 2: Verify in browser console**

```js
// 0 entries
localStorage.removeItem("dashboard_snapshot_history");
calculateKPIs(); // or just call renderTrendsSummary() directly if patientsData is already loaded
document.getElementById('trends-delta-summary').innerText
// expect "No snapshot history yet — upload a tracker file to start tracking trends."

// 1 entry
localStorage.setItem("dashboard_snapshot_history", JSON.stringify([
    { date: "2026-07-20", timestamp: "x", summary: { total: 100, active: 50, pendingReferrals: 10, ncmCount: 5, activeBarriers: 8, dataCompleteness: 70, avgTurnaround: 12 } }
]));
renderTrendsSummary();
document.getElementById('trends-delta-summary').innerText
// expect "First recorded snapshot (2026-07-20). Trends will appear after your next upload."

// 2 entries with changes
localStorage.setItem("dashboard_snapshot_history", JSON.stringify([
    { date: "2026-07-20", timestamp: "x", summary: { total: 100, active: 50, pendingReferrals: 10, ncmCount: 5, activeBarriers: 8, dataCompleteness: 70, avgTurnaround: 12 } },
    { date: "2026-07-21", timestamp: "x", summary: { total: 105, active: 52, pendingReferrals: 12, ncmCount: 6, activeBarriers: 5, dataCompleteness: 72, avgTurnaround: 11 } }
]));
renderTrendsSummary();
document.getElementById('trends-delta-summary').innerText
// expect "Since last upload (2026-07-21): +5 patients, -3 barriers, +2 pending referrals."

// Reload the page afterward to restore real history / real data state.
```

Note: if this browser has real cached history from earlier task testing, this test temporarily overwrites it via `localStorage.setItem` directly — reload afterward (a plain reload re-reads whatever is in `localStorage` at that time, which will just be your last test values; if you need to fully restore prior real state, don't run this test's `localStorage.setItem` calls against a browser with real data you care about — use an incognito/private window or a browser profile without real cached data for this specific step if that's a concern, otherwise proceed and note in your report that history was overwritten by this test).

## Context

This is Task 5 of 7. It depends on Task 1's `readSnapshotHistory()` and Task 4's `trends-delta-summary` element id already existing. `calculateKPIs()` already runs on every data load (both cache-reload and fresh upload), so this delta summary updates automatically alongside the rest of the Overview KPIs — no separate wiring needed beyond this one call.

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

- Is `renderTrendsSummary()` present with EXACTLY the specified body, and called once from `calculateKPIs()` right after `renderOperationalKPIs();`?
- Do all 4 message variants (0 entries, 1 entry, 2+ entries with changes, 2+ entries with no changes) match the spec's exact wording?
- Did you avoid touching `renderOperationalKPIs` or anything else in `calculateKPIs`?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 6: Trend line chart

**Files:**
- Modify: `dashboard.js:2304-2334` (end of `renderCharts`, after "Chart 4")

- [ ] **Step 1: Add the 5th chart**

Find:

```js
    const ctxCoord = coordinatorsCanvas.getContext('2d');
    charts.coordinators = new Chart(ctxCoord, {
        type: 'bar',
        data: {
            labels: Object.keys(coordMap),
            datasets: [{
                label: 'Total Coordinated Cases',
                data: Object.values(coordMap),
                backgroundColor: '#3b82f6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor } },
                y: { grid: { color: gridColor }, ticks: { color: textColor } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function updateChartsTheme() {
```

Replace with:

```js
    const ctxCoord = coordinatorsCanvas.getContext('2d');
    charts.coordinators = new Chart(ctxCoord, {
        type: 'bar',
        data: {
            labels: Object.keys(coordMap),
            datasets: [{
                label: 'Total Coordinated Cases',
                data: Object.values(coordMap),
                backgroundColor: '#3b82f6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor } },
                y: { grid: { color: gridColor }, ticks: { color: textColor } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });

    // Chart 5: Trends (Last 90 Days) — Total Patients, Active Barriers, Pending Referrals
    const trendsCanvas = document.getElementById('chart-trends');
    const history = readSnapshotHistory();
    if (trendsCanvas && history.length > 0) {
        const ctxTrends = trendsCanvas.getContext('2d');
        charts.trends = new Chart(ctxTrends, {
            type: 'line',
            data: {
                labels: history.map(e => e.date),
                datasets: [
                    { label: 'Total Patients', data: history.map(e => e.summary.total), borderColor: '#3b82f6', tension: 0.3 },
                    { label: 'Active Barriers', data: history.map(e => e.summary.activeBarriers), borderColor: '#ef4444', tension: 0.3 },
                    { label: 'Pending Referrals', data: history.map(e => e.summary.pendingReferrals), borderColor: '#f59e0b', tension: 0.3 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: textColor } },
                    y: { grid: { color: gridColor }, ticks: { color: textColor } }
                },
                plugins: {
                    legend: { labels: { color: textColor } }
                }
            }
        });
    }
}

function updateChartsTheme() {
```

IMPORTANT: `function updateChartsTheme() {` appears exactly once in the file, right after `renderCharts()` closes. Confirm you're inserting the new chart block just before that closing `}` and the `updateChartsTheme` function, not somewhere else. Do NOT add `trendsCanvas` to the earlier mandatory-canvas guard (`if (!clinicCanvas || !referralCanvas || !diagnosesCanvas || !coordinatorsCanvas) { ... return; }`, near the top of `renderCharts`) — the trends chart is intentionally optional (skipped entirely when there's no history yet), unlike the other 4 charts which require real patient data to always be present.

- [ ] **Step 2: Verify in browser console**

```js
// Seed 3 days of history and confirm the chart renders without error
localStorage.setItem("dashboard_snapshot_history", JSON.stringify([
    { date: "2026-07-18", timestamp: "x", summary: { total: 90, active: 40, pendingReferrals: 8, ncmCount: 4, activeBarriers: 10, dataCompleteness: 65, avgTurnaround: 14 } },
    { date: "2026-07-20", timestamp: "x", summary: { total: 100, active: 50, pendingReferrals: 10, ncmCount: 5, activeBarriers: 8, dataCompleteness: 70, avgTurnaround: 12 } },
    { date: "2026-07-21", timestamp: "x", summary: { total: 105, active: 52, pendingReferrals: 12, ncmCount: 6, activeBarriers: 5, dataCompleteness: 72, avgTurnaround: 11 } }
]));
renderCharts();
charts.trends !== undefined   // expect true
charts.trends.data.labels     // expect ["2026-07-18", "2026-07-20", "2026-07-21"]
```

If a browser tool is available: visually confirm the "Trends (Last 90 Days)" card now shows a 3-point line chart with 3 series (check the legend: Total Patients / Active Barriers / Pending Referrals). Toggle dark/light theme (sidebar button) and confirm the chart redraws correctly in both (via the pre-existing `updateChartsTheme()` → `renderCharts()` path, no new code needed for this to work). Reload the page afterward to restore real history/data state (same caveat as Task 5 — this test's `localStorage.setItem` temporarily overwrites real history if present).

If no browser tool: verify by manual code trace, and by confirming `Chart` (global from the Chart.js CDN script) is only ever constructed with `trendsCanvas && history.length > 0` both true, matching the "chart canvas left un-rendered when there's no history" edge case from the spec.

## Context

This is Task 6 of 7, the last data-rendering task. It depends on Task 1 (`readSnapshotHistory`), Task 4 (`chart-trends` canvas id). Because this is added inside the *existing* `renderCharts()` function rather than a new standalone function, it automatically participates in that function's existing `Object.values(charts).forEach(c => c.destroy())` cleanup at the top (already generic — works for any key on the `charts` object, no change needed there) and in `updateChartsTheme()`'s existing "just call `renderCharts()` again" redraw-on-theme-toggle behavior — zero additional wiring required for correct theme behavior.

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

- Is the 5th chart block present with EXACTLY the specified body, positioned after Chart 4 and before `updateChartsTheme()`?
- Is it correctly guarded so it's skipped (no `new Chart(...)` call, no error) when `history.length === 0`?
- Did you avoid adding `trendsCanvas` to the earlier mandatory 4-canvas guard?
- Did you avoid touching Chart 1-4 or `updateChartsTheme()` itself?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you verified and how, with results
- Files changed
- Self-review findings
- Any concerns

---

### Task 7: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Full manual walkthrough**

**PHI caution:** the Trends section only ever shows aggregate numbers — safe to screenshot. Do NOT screenshot any other tab (Master Registry, Patient Search, etc.) if real patient data is loaded in the test browser.

1. If the test browser already has real cached data AND real snapshot history from earlier task testing, that's fine to use as-is (read-only, aggregate-only). If you need a clean-slate test instead, use "Clear Browser Cache" in Settings first (this now also clears snapshot history, per Task 3).
2. Upload a tracker file (or use already-loaded real data). Confirm the Overview tab's Trends section shows a sensible delta summary and, once 2+ days of history exist, a line chart.
3. Cross-check: run `readSnapshotHistory()` in the console; confirm its length and latest entry's `summary` match what's displayed (compare `summary.total` against the `kpi-total-patients` KPI card, `summary.activeBarriers` against `kpi-active-barriers`, etc. — these should already agree since both are computed from the same `patientsData`).
4. If only 1 real snapshot exists so far (first time using this feature), that's an acceptable end state for this check — confirm the "First recorded snapshot" message displays correctly and move on to a synthetic multi-day test instead (per Task 5/6's console-based verification approach) to confirm the delta/chart logic itself, without needing to wait for real multiple days of usage.
5. Confirm the "Clear Browser Cache" button removes both `dashboard_static_data` and `dashboard_snapshot_history` (check `readSnapshotHistory()` returns `[]` after).
6. Toggle dark/light theme; confirm the Trends card and chart render correctly in both.
7. Confirm Phase 1 (Operational KPIs) and Phase 2 (Workload & Capacity) still work correctly — this phase touched `calculateKPIs()`, `applyDashboardData()`, and `renderCharts()`, all of which those earlier phases also depend on, so a regression check here is important.
8. Open DevTools console; confirm no new errors or warnings appear that weren't present before this change.

- [ ] **Step 2: Done**

If all checks in Step 1 pass, Phase 3 (Snapshot History) is complete. This was the last planned phase from the original roadmap besides Phase 4 (Daily Digest, which depends on Phases 1-2's outputs) and the independent RTL item — check with the user for next steps.
