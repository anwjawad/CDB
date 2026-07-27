# Phase 3: Snapshot History / Trend Tracking

## Context

Third phase of the OncoCoord v3 dashboard roadmap (Phase 1 — Operational KPIs — and Phase 2 — Workload & Capacity — are complete). The dashboard is fully client-side, no backend: every Excel upload overwrites `localStorage["dashboard_static_data"]` entirely via `applyDashboardData()` in `dashboard.js`. There is currently zero historical memory — the app only ever knows the state of the *most recent* upload.

This phase adds a lightweight, aggregate-only snapshot history so the Overview tab can show trend lines and a simple "since last upload" delta, without meaningfully growing `localStorage` usage or coupling to individual patient records across time.

**This is the architecturally riskiest phase of the roadmap** — it's the first change to the storage model itself (a new persistent key, growing over time, with retention logic) rather than a pure read/render addition like Phases 1–2.

## Goals

1. Record one aggregate snapshot per calendar day (local time), only when a real Excel upload succeeds — not on page reload / cache-only loads.
2. Retain up to 90 days of history; older entries are pruned automatically.
3. Show a trend line chart (Total Patients, Active Barriers, Pending Referrals) and a short "since last upload" delta summary in the Overview tab, under the existing Phase 1 "Operational KPIs" section.
4. "Clear Browser Cache" (Settings tab) also clears snapshot history, so a full reset is actually full.

## Data Model

New, separate `localStorage` key — does **not** touch or grow `dashboard_static_data`:

```js
STORAGE_KEYS.snapshotHistory = "dashboard_snapshot_history"
```

Value: a JSON array of entries, sorted ascending by `date`:

```js
{
    date: "2026-07-22",           // local YYYY-MM-DD, used as the one-per-day dedup key
    timestamp: "7/22/2026, 11:51:20 AM",  // display string, same locale format as existing last-sync display
    summary: {
        total: 310,
        active: 147,
        pendingReferrals: 24,
        ncmCount: 171,
        activeBarriers: 89,
        dataCompleteness: 79,     // Math.round(computeAvgCompleteness()), Phase 1
        avgTurnaround: 13.3       // computeAvgTurnaroundDays(), Phase 1 (may be null)
    }
}
```

No per-patient data is stored — only these 7 numbers per day. At 90 days retained, this is on the order of a few KB total, regardless of patient count.

## New Functions (`dashboard.js`)

```js
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
```

`computeSnapshotSummary()`'s `active`/`pendingReferrals`/`ncmCount`/`activeBarriers` logic intentionally mirrors the existing (pre-Phase-3) local variables inside `calculateKPIs()` exactly — same status-value checks, same helpers (`isPendingValue`, `isYesValue`, `hasActiveBarrier`) — so the recorded numbers always agree with what the Overview KPI cards show at that moment. This is a small, deliberate duplication rather than refactoring `calculateKPIs()`'s internals, matching Phase 1/2's precedent of adding independent aggregate functions instead of modifying existing ones.

`writeStorage()` (pre-existing) already handles `localStorage` write failures gracefully (try/catch, error toast) — `recordSnapshot()` relies on that existing behavior, no new error handling needed.

## Wiring

- `recordSnapshot()` is called from `applyDashboardData()`, right after the existing `writeStorage(STORAGE_KEYS.data, ...)` call — i.e., only on a real, successful Excel upload (`processUploadedExcel` → `applyDashboardData`), never from `loadDashboardData()` (which only re-reads the cache on page load and must NOT create/overwrite a snapshot).
- `readSnapshotHistory()` is called by two new render functions (below), triggered the same place `renderOperationalKPIs()` already is: inside `calculateKPIs()`, which runs on every data load/upload.

## UI: Overview Tab

New section added directly below the existing Phase 1 "Operational KPIs" section (`#operational-kpi-grid`), reusing the same `.dashboard-section-header` pattern:

```html
<div class="dashboard-section-header">
    <h3>Trends (Last 90 Days)</h3>
</div>
<div class="dashboard-card glass-card">
    <p id="trends-delta-summary" class="kpi-context"></p>
    <div class="chart-container">
        <canvas id="chart-trends" role="img" aria-label="Line chart: patient totals, barriers, and pending referrals over the last 90 days"></canvas>
    </div>
</div>
```

### Delta summary (`renderTrendsSummary()`)

- 0 entries: `"No snapshot history yet — upload a tracker file to start tracking trends."`
- 1 entry: `"First recorded snapshot (<date>). Trends will appear after your next upload."`
- 2+ entries: compares the latest two entries' `summary.total`/`activeBarriers`/`pendingReferrals`, formats as e.g. `"Since last upload (<date>): +5 patients, -3 barriers, +2 pending referrals"` — a metric with zero change is omitted from the sentence; if all three are zero, show `"Since last upload (<date>): no change."`

### Trend chart (`renderCharts()`, extended)

Added as a 5th chart inside the *existing* `renderCharts()` function (not a separate lifecycle) — same theme-aware colors, same `Object.values(charts).forEach(c => c.destroy())` cleanup at the top of that function, so it's automatically redrawn on theme toggle via the existing `updateChartsTheme()` with zero new code there:

```js
const history = readSnapshotHistory();
// ... (chart only constructed when history.length > 0, see below)
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
        plugins: { legend: { labels: { color: textColor } } }
    }
});
```

If `history.length === 0`, the chart canvas is left un-rendered (no `new Chart(...)` call for it that render pass) and `renderTrendsSummary()`'s empty-state text communicates why — avoids Chart.js rendering an awkward empty axis.

## Settings Tab: Extend "Clear Browser Cache"

The existing `reset-cache-btn` handler (in `setupResetCache()`) currently only calls `removeStorage(STORAGE_KEYS.data)`. It's extended to also call `removeStorage(STORAGE_KEYS.snapshotHistory)`, so a full cache clear also clears trend history — otherwise a user who intentionally wipes their data would still see old trend lines reappear on next upload, which would be confusing.

## Edge Cases

- First-ever upload (no prior history): 1-entry array after `recordSnapshot()`, delta summary shows the "first recorded snapshot" message, chart shows a single point.
- Multiple uploads same day: `recordSnapshot()`'s `findIndex` + overwrite logic means only the LAST upload of a given day is reflected in that day's entry — earlier same-day uploads that day are not separately visible in history (by design, per the "one snapshot per day" decision).
- `avgTurnaround` can be `null` (Phase 1 behavior when no patient has both valid visit/chemo dates) — stored as `null` in the snapshot; not currently plotted on the trend chart (only `total`/`activeBarriers`/`pendingReferrals` are charted per the approved design), so this doesn't need special handling in the chart, only in the data model (JSON.stringify/parse round-trips `null` fine).
- Corrupted/manually-edited `localStorage` snapshot history JSON: `readSnapshotHistory()` catches the parse error and resets to `[]` (loses history, but never crashes the app) — same defensive pattern as `loadDashboardData()`'s existing try/catch around `JSON.parse`.
- `localStorage` quota exceeded when writing the snapshot: `writeStorage()`'s existing try/catch surfaces an error toast; the snapshot for that day simply isn't saved (previously-saved days are unaffected since they're already persisted).

## Out of Scope (deferred / explicitly rejected by user's answers)

- Per-patient historical diffing ("which specific patient's barrier resolved") — user chose aggregate-only.
- Configurable retention window or manual "save snapshot" button — fixed 90-day / automatic-daily per user's decisions.
- A dedicated "Trends" tab with a full history table — user chose to keep this inside the existing Overview tab.

## Testing / Verification Plan

Manual, in-browser (no test framework in this project), same approach as Phases 1–2:

1. Clear cache, upload a tracker file. Confirm `localStorage["dashboard_snapshot_history"]` has exactly 1 entry matching today's date and the correct aggregate numbers (cross-check against `computeSnapshotSummary()` called directly in the console).
2. Confirm the Overview tab shows the "First recorded snapshot" message and a single-point chart.
3. Simulate a second day by manually editing the stored history's `date` to yesterday (console), then re-upload the same file — confirm a NEW entry is added (2 total), the delta summary shows a sensible (zero, since same data) comparison, and the chart now shows 2 points.
4. Re-upload again the same (simulated) day without changing the date — confirm the entry count stays at 2 (today's entry overwritten, not duplicated).
5. Manually seed >90 days of history via console, re-upload, confirm entries older than 90 days from today are pruned.
6. Click "Clear Browser Cache" in Settings; confirm both `dashboard_static_data` and `dashboard_snapshot_history` are removed from `localStorage`.
7. Confirm the trend chart renders correctly in dark and light theme (toggle, same as Phases 1–2).
8. Confirm no console errors, and that Phase 1/2 features (Operational KPIs, Workload & Capacity) still work unaffected.
