# Operational KPIs (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new operational metrics (Aging/SLA buckets, Data Completeness Score, Referral Turnaround Time) to the Overview tab of the OncoCoord v3 dashboard, computed client-side from existing patient data.

**Architecture:** Pure-function helpers added to `dashboard.js` following the codebase's existing `VALUE_ALIASES`/`isYesValue`-style conventions; six new read-only KPI cards added to `index.html`'s Overview tab reusing existing `.kpi-card` styling; wiring into the existing `calculateKPIs()` render pipeline and `initApp()` click-handler setup. No new architecture, no build step, no dependencies.

**Tech Stack:** Vanilla JS (ES6+), no framework, no bundler. No test framework exists in this project — verification is done by pasting function calls into the browser DevTools console (all functions are global `<script>` scope, not modules) and by visual/manual checks in the running page.

**Spec:** `docs/superpowers/specs/2026-07-22-operational-kpis-design.md`

**No git repo in this project.** Do not run `git init`, `git add`, or `git commit` at any point in this plan — there are no commit steps below by design.

---

### Task 1: Closed-case detection helpers

**Files:**
- Modify: `dashboard.js:19-26` (VALUE_ALIASES)
- Modify: `dashboard.js:161-166` (insert after `getPatientVal`, before `hasActiveBarrier`)

- [ ] **Step 1: Add a `closed` alias group to `VALUE_ALIASES`**

In `dashboard.js`, find:

```js
const VALUE_ALIASES = Object.freeze({
    yes: ["yes", "y", "true", "1", "نعم"],
    no: ["no", "n", "false", "0", "0.0", "none", "لا"],
    pending: ["pending", "on hold", "قيد الانتظار", "معلق"],
    approved: ["approved", "active", "yes", "completed", "complete", "نعم", "موافق عليه", "تم التنسيق"],
    rejected: ["rejected", "closed", "no", "لا", "مرفوض", "ملغي"],
    treatment: ["treatment", "علاج"]
});
```

Replace with:

```js
const VALUE_ALIASES = Object.freeze({
    yes: ["yes", "y", "true", "1", "نعم"],
    no: ["no", "n", "false", "0", "0.0", "none", "لا"],
    pending: ["pending", "on hold", "قيد الانتظار", "معلق"],
    approved: ["approved", "active", "yes", "completed", "complete", "نعم", "موافق عليه", "تم التنسيق"],
    rejected: ["rejected", "closed", "no", "لا", "مرفوض", "ملغي"],
    treatment: ["treatment", "علاج"],
    closed: ["closed", "completed", "complete", "discharged", "مكتمل", "مغلق", "منتهي"]
});
```

- [ ] **Step 2: Add `isClosedValue`/`isClosedCase` helpers**

In `dashboard.js`, find the end of `getPatientVal` and the start of `hasActiveBarrier`:

```js
    return "";
}

function hasActiveBarrier(pat) {
```

Replace with:

```js
    return "";
}

// --- Operational KPIs: Aging / Completeness / Turnaround helpers ---
function isClosedValue(value) { return valueMatches(value, "closed"); }
function isClosedCase(pat) { return isClosedValue(getPatientVal(pat, 'status')); }

function hasActiveBarrier(pat) {
```

- [ ] **Step 3: Verify in browser console**

Open `index.html` in a browser (double-click it, or `python -m http.server 8080` then visit `http://localhost:8080`). Open DevTools console and run:

```js
isClosedCase({ "Case Status": "Closed" })
isClosedCase({ "Case Status": "Completed" })
isClosedCase({ "Case Status": "Active" })
isClosedCase({ "Case Status": "" })
```

Expected: `true`, `true`, `false`, `false`.

---

### Task 2: Aging bucket helpers

**Files:**
- Modify: `dashboard.js` (insert immediately after the `isClosedCase` function added in Task 1)

- [ ] **Step 1: Add `getPatientAgingDays`, `getAgingBucket`, `matchesAgingBucket`**

Find:

```js
function isClosedValue(value) { return valueMatches(value, "closed"); }
function isClosedCase(pat) { return isClosedValue(getPatientVal(pat, 'status')); }

function hasActiveBarrier(pat) {
```

Replace with:

```js
function isClosedValue(value) { return valueMatches(value, "closed"); }
function isClosedCase(pat) { return isClosedValue(getPatientVal(pat, 'status')); }

function getPatientAgingDays(pat) {
    if (isClosedCase(pat)) return null;
    if (isValidDateValue(getPatientVal(pat, 'chemoDate'))) return null;
    const visitDate = getPatientVal(pat, 'visitDate');
    if (!isValidDateValue(visitDate)) return null;
    const diffMs = Date.now() - new Date(visitDate + "T00:00:00").getTime();
    return Math.floor(diffMs / 86400000);
}

function getAgingBucket(days) {
    if (days === null || days === undefined) return null;
    if (days <= 3) return '0-3';
    if (days <= 7) return '4-7';
    if (days <= 14) return '8-14';
    return '15+';
}

function matchesAgingBucket(pat, bucketKey) {
    return getAgingBucket(getPatientAgingDays(pat)) === bucketKey;
}

function hasActiveBarrier(pat) {
```

- [ ] **Step 2: Verify in browser console**

```js
// Build a local-calendar date string (matches how the app parses "YYYY-MM-DD" as local midnight —
// using toISOString() here would shift by your UTC offset and throw the day count off by one).
function localDateStr(daysAgo) {
    const dt = new Date();
    dt.setDate(dt.getDate() - daysAgo);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// A patient who visited 10 days ago, no chemo date, not closed
const d = localDateStr(10);
const p = { "Patient Name": "Test", "Date of clinic visit": d, "Case Status": "Active" };
getPatientAgingDays(p)          // expect 10
getAgingBucket(getPatientAgingDays(p))   // expect '8-14'
matchesAgingBucket(p, '8-14')   // expect true
matchesAgingBucket(p, '0-3')    // expect false

// Closed case is excluded regardless of visit date
getPatientAgingDays({ "Date of clinic visit": d, "Case Status": "Closed" })  // expect null

// Patient who already reached chemo scheduling is excluded
getPatientAgingDays({ "Date of clinic visit": d, "chemotherapy Appointment Date": "2026-08-01", "Case Status": "Active" })  // expect null
```

---

### Task 3: Data completeness helpers

**Files:**
- Modify: `dashboard.js` (insert immediately after `matchesAgingBucket`, added in Task 2)

- [ ] **Step 1: Add `getPatientCompleteness` and `computeAvgCompleteness`**

Find:

```js
function matchesAgingBucket(pat, bucketKey) {
    return getAgingBucket(getPatientAgingDays(pat)) === bucketKey;
}

function hasActiveBarrier(pat) {
```

Replace with:

```js
function matchesAgingBucket(pat, bucketKey) {
    return getAgingBucket(getPatientAgingDays(pat)) === bucketKey;
}

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

function hasActiveBarrier(pat) {
```

- [ ] **Step 2: Verify in browser console**

```js
// KEY_MAP has 27 keys. A patient with only "name" filled should be ~3.7%
getPatientCompleteness({ "Patient Name": "Test" })   // expect ~3.7 (1/27 * 100)

// Empty patient object -> 0
getPatientCompleteness({})   // expect 0

// computeAvgCompleteness needs patientsData populated -- set a temporary value to check the aggregate logic:
patientsData = [{ "Patient Name": "A", "Case Status": "Active" }, { "Patient Name": "B", "Case Status": "Closed" }];
computeAvgCompleteness()   // expect 7 (Math.round of patient A's ~7.4% completeness; B is excluded because it's closed)
// Reload the page afterward to restore real data.
```

---

### Task 4: Referral turnaround helper

**Files:**
- Modify: `dashboard.js` (insert immediately after `computeAvgCompleteness`, added in Task 3)

- [ ] **Step 1: Add `computeAvgTurnaroundDays`**

Find:

```js
function computeAvgCompleteness() {
    const eligible = patientsData.filter(pat => !isClosedCase(pat));
    if (eligible.length === 0) return 0;
    const total = eligible.reduce((sum, pat) => sum + getPatientCompleteness(pat), 0);
    return Math.round(total / eligible.length);
}

function hasActiveBarrier(pat) {
```

Replace with:

```js
function computeAvgCompleteness() {
    const eligible = patientsData.filter(pat => !isClosedCase(pat));
    if (eligible.length === 0) return 0;
    const total = eligible.reduce((sum, pat) => sum + getPatientCompleteness(pat), 0);
    return Math.round(total / eligible.length);
}

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

function hasActiveBarrier(pat) {
```

- [ ] **Step 2: Verify in browser console**

```js
patientsData = [
    { "Date of clinic visit": "2026-06-01", "chemotherapy Appointment Date": "2026-06-15" }, // 14 days
    { "Date of clinic visit": "2026-06-01", "chemotherapy Appointment Date": "2026-06-11" }, // 10 days
    { "Date of clinic visit": "2026-06-01", "chemotherapy Appointment Date": "" }             // no chemo date, excluded
];
computeAvgTurnaroundDays()   // expect 12 ((14+10)/2)

patientsData = [];
computeAvgTurnaroundDays()   // expect null
// Reload the page afterward to restore real data.
```

---

### Task 5: Wire new quick filters

**Files:**
- Modify: `dashboard.js:417-456` (`matchesPatientQuickFilter`)

- [ ] **Step 1: Add 5 new filter branches**

Find:

```js
    if (filterName === 'data-problems') {
        return getDataProblems(pat).length > 0;
    }
    return true;
}
```

Replace with:

```js
    if (filterName === 'data-problems') {
        return getDataProblems(pat).length > 0;
    }
    if (filterName === 'data-incomplete') {
        return getPatientCompleteness(pat) < 100;
    }
    if (filterName === 'aging-0-3') {
        return matchesAgingBucket(pat, '0-3');
    }
    if (filterName === 'aging-4-7') {
        return matchesAgingBucket(pat, '4-7');
    }
    if (filterName === 'aging-8-14') {
        return matchesAgingBucket(pat, '8-14');
    }
    if (filterName === 'aging-15-plus') {
        return matchesAgingBucket(pat, '15+');
    }
    return true;
}
```

- [ ] **Step 2: Verify in browser console**

```js
function localDateStr(daysAgo) {
    const dt = new Date();
    dt.setDate(dt.getDate() - daysAgo);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
const d = localDateStr(20);
const p = { "Patient Name": "Test", "Date of clinic visit": d, "Case Status": "Active" };
matchesPatientQuickFilter(p, 'aging-15-plus')   // expect true
matchesPatientQuickFilter(p, 'aging-0-3')       // expect false
matchesPatientQuickFilter({ "Patient Name": "Test" }, 'data-incomplete')  // expect true
```

---

### Task 6: Overview tab markup

**Files:**
- Modify: `index.html` (inside `#tab-overview`, right after the existing `.kpi-grid` closes)

- [ ] **Step 1: Insert the new Operational KPIs section**

Find (this is the end of the existing `.kpi-grid` block and the start of the Charts section):

```html
                    </div>

                    <!-- Charts & Insights -->
                    <div class="dashboard-grid">
```

Replace with:

```html
                    </div>

                    <!-- Operational KPIs (Phase 1) -->
                    <div class="dashboard-section-header">
                        <h3>Operational KPIs</h3>
                    </div>
                    <div class="kpi-grid" id="operational-kpi-grid">
                        <div class="kpi-card glass-card ripple" id="okpi-completeness">
                            <div class="kpi-icon icon-blue"><i class="fa-solid fa-list-check"></i></div>
                            <div class="kpi-data">
                                <h3>Data Completeness</h3>
                                <p class="kpi-value" id="okpi-completeness-val">0%</p>
                                <span class="kpi-context">Avg. across active files</span>
                            </div>
                        </div>
                        <div class="kpi-card glass-card ripple" id="okpi-turnaround">
                            <div class="kpi-icon icon-indigo"><i class="fa-solid fa-hourglass-half"></i></div>
                            <div class="kpi-data">
                                <h3>Avg. Referral Turnaround</h3>
                                <p class="kpi-value" id="okpi-turnaround-val">—</p>
                                <span class="kpi-context">Visit → Chemo, days</span>
                            </div>
                        </div>
                        <div class="kpi-card glass-card ripple" id="okpi-aging-0-3">
                            <div class="kpi-icon icon-green"><i class="fa-solid fa-hourglass-start"></i></div>
                            <div class="kpi-data">
                                <h3>Aging: 0-3 days</h3>
                                <p class="kpi-value" id="okpi-aging-0-3-val">0</p>
                                <span class="kpi-context">Since clinic visit</span>
                            </div>
                        </div>
                        <div class="kpi-card glass-card ripple" id="okpi-aging-4-7">
                            <div class="kpi-icon icon-blue"><i class="fa-solid fa-hourglass-half"></i></div>
                            <div class="kpi-data">
                                <h3>Aging: 4-7 days</h3>
                                <p class="kpi-value" id="okpi-aging-4-7-val">0</p>
                                <span class="kpi-context">Since clinic visit</span>
                            </div>
                        </div>
                        <div class="kpi-card glass-card ripple" id="okpi-aging-8-14">
                            <div class="kpi-icon icon-amber"><i class="fa-solid fa-hourglass-end"></i></div>
                            <div class="kpi-data">
                                <h3>Aging: 8-14 days</h3>
                                <p class="kpi-value" id="okpi-aging-8-14-val">0</p>
                                <span class="kpi-context">Since clinic visit</span>
                            </div>
                        </div>
                        <div class="kpi-card glass-card ripple" id="okpi-aging-15-plus">
                            <div class="kpi-icon icon-danger"><i class="fa-solid fa-triangle-exclamation"></i></div>
                            <div class="kpi-data">
                                <h3>Aging: 15+ days</h3>
                                <p class="kpi-value" id="okpi-aging-15-plus-val">0</p>
                                <span class="kpi-context">Since clinic visit</span>
                            </div>
                        </div>
                    </div>

                    <!-- Charts & Insights -->
                    <div class="dashboard-grid">
```

- [ ] **Step 2: Verify**

Open `index.html` in a browser. On the Overview tab, confirm a new "Operational KPIs" heading and 6 cards appear below the existing 5 KPI cards, showing default placeholder values (`0%`, `—`, `0`, `0`, `0`, `0`) since the JS wiring isn't connected yet (Tasks 8-9).

---

### Task 7: Section header styling

**Files:**
- Modify: `styles.css:387-390`

- [ ] **Step 1: Add `.dashboard-section-header` rule**

Find:

```css
.card-header h3 {
    font-size: 15px;
    font-weight: 600;
}
```

Replace with:

```css
.card-header h3 {
    font-size: 15px;
    font-weight: 600;
}

.dashboard-section-header {
    margin: 28px 0 16px;
}

.dashboard-section-header h3 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
}
```

- [ ] **Step 2: Verify**

Reload `index.html`. Confirm the "Operational KPIs" heading added in Task 6 is visibly styled (not default browser `<h3>` styling), and matches in both dark and light theme (use the theme toggle button in the sidebar).

---

### Task 8: Render operational KPIs into the DOM

**Files:**
- Modify: `dashboard.js` (new function, placed after `setupInteractiveKPIs`, ends at `dashboard.js:676`)
- Modify: `dashboard.js:1224-1225` (inside `calculateKPIs`)

- [ ] **Step 1: Add `renderOperationalKPIs()`**

Find (end of `setupInteractiveKPIs` and the App Initialization comment):

```js
    });
}


// --- App Initialization ---
document.addEventListener("DOMContentLoaded", () => {
```

Replace with:

```js
    });
}

function renderOperationalKPIs() {
    const completenessVal = document.getElementById("okpi-completeness-val");
    if (completenessVal) completenessVal.innerText = `${computeAvgCompleteness()}%`;

    const turnaroundVal = document.getElementById("okpi-turnaround-val");
    if (turnaroundVal) {
        const avgTurnaround = computeAvgTurnaroundDays();
        turnaroundVal.innerText = avgTurnaround === null ? "—" : `${avgTurnaround}d`;
    }

    const bucketCounts = { '0-3': 0, '4-7': 0, '8-14': 0, '15+': 0 };
    patientsData.forEach(pat => {
        const bucket = getAgingBucket(getPatientAgingDays(pat));
        if (bucket) bucketCounts[bucket]++;
    });

    const bucketElIds = {
        '0-3': 'okpi-aging-0-3-val',
        '4-7': 'okpi-aging-4-7-val',
        '8-14': 'okpi-aging-8-14-val',
        '15+': 'okpi-aging-15-plus-val'
    };
    for (const [bucket, elId] of Object.entries(bucketElIds)) {
        const el = document.getElementById(elId);
        if (el) el.innerText = bucketCounts[bucket];
    }
}


// --- App Initialization ---
document.addEventListener("DOMContentLoaded", () => {
```

- [ ] **Step 2: Call it from `calculateKPIs()`**

Find:

```js
    document.getElementById("kpi-active-barriers").innerText = activeBarriers;
    updateMasterFunnel();
    updateTriageBanner(activeBarriers, missingChemo, pendingReferrals, ncmCount);
}
```

Replace with:

```js
    document.getElementById("kpi-active-barriers").innerText = activeBarriers;
    updateMasterFunnel();
    updateTriageBanner(activeBarriers, missingChemo, pendingReferrals, ncmCount);
    renderOperationalKPIs();
}
```

- [ ] **Step 3: Verify**

Serve the app (`python -m http.server 8080` from the project directory, then visit `http://localhost:8080`) and upload a real or sample `.xlsx` tracker via the "Upload Excel File" button. Confirm the 6 new Overview cards populate with non-placeholder numbers matching a manual spot-check against 3-5 rows in the source spreadsheet (per the spec's verification plan).

---

### Task 9: Wire KPI card clicks to Master Registry filters

**Files:**
- Modify: `dashboard.js` (new function, placed after `renderOperationalKPIs`, added in Task 8)
- Modify: `dashboard.js:690` (inside `initApp`)

- [ ] **Step 1: Add `setupOperationalKPIClicks()`**

Find:

```js
    for (const [bucket, elId] of Object.entries(bucketElIds)) {
        const el = document.getElementById(elId);
        if (el) el.innerText = bucketCounts[bucket];
    }
}


// --- App Initialization ---
```

Replace with:

```js
    for (const [bucket, elId] of Object.entries(bucketElIds)) {
        const el = document.getElementById(elId);
        if (el) el.innerText = bucketCounts[bucket];
    }
}

function setupOperationalKPIClicks() {
    const wireCard = (elId, filters) => {
        const card = document.getElementById(elId);
        if (!card) return;
        card.addEventListener("click", () => {
            setQuickFilters(filters);
            pagination.currentPage = 1;
            applyFilters();
            switchToMasterTab();
        });
    };

    wireCard("okpi-completeness", ["data-incomplete"]);
    wireCard("okpi-turnaround", ["chemo-scheduled"]);
    wireCard("okpi-aging-0-3", ["aging-0-3"]);
    wireCard("okpi-aging-4-7", ["aging-4-7"]);
    wireCard("okpi-aging-8-14", ["aging-8-14"]);
    wireCard("okpi-aging-15-plus", ["aging-15-plus"]);
}


// --- App Initialization ---
```

- [ ] **Step 2: Call it from `initApp()`**

Find:

```js
    setupFilterListeners();
    setupInteractiveKPIs();
    setupPagination();
```

Replace with:

```js
    setupFilterListeners();
    setupInteractiveKPIs();
    setupOperationalKPIClicks();
    setupPagination();
```

- [ ] **Step 3: Verify**

Reload the app with data loaded (from Task 8's upload, or from cache). Click each of the 6 new Overview cards one at a time. For each click, confirm:
1. The app switches to the Master Registry tab.
2. The "Matching records" count at the top of the table matches the number shown on the KPI card you clicked.
3. Clicking "Clear Filters" in Master Registry resets the view before testing the next card.

---

### Task 10: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Full manual walkthrough**

With a real (or realistic sample) tracker `.xlsx` loaded:

1. Confirm all 6 Operational KPI values are non-`NaN`, non-`undefined`, and match manual spot-checks against 3-5 patient rows (per spec).
2. Confirm closed/completed cases are excluded from the 4 Aging buckets and from the Data Completeness average (temporarily change one patient's Case Status in the source Excel to "Closed", re-upload, confirm the aging/completeness numbers shift accordingly, then revert).
3. Reload the page without re-uploading (data should load from `localStorage` cache) — confirm the 6 KPIs render identically.
4. Toggle dark/light theme (sidebar toggle button) — confirm all 6 new cards and the new section heading render correctly in both themes.
5. Click through all 6 cards per Task 9, Step 3.
6. Open DevTools console, confirm no new errors or warnings appear that weren't present before this change.

- [ ] **Step 2: Done**

If all checks in Step 1 pass, Phase 1 (Operational KPIs) is complete. Phase 2 (Workload & Capacity) can be brainstormed and planned next, per `docs/superpowers/specs/2026-07-22-operational-kpis-design.md`'s roadmap context.
