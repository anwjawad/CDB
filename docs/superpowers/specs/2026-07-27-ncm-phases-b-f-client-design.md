# NCM Collaborative Workspace — Phases B–F: Client-Side Implementation

Built under full-autonomy delegation from the user (no per-phase approval gate) after Phase A (backend) shipped. This doc records what was actually built, for the same audit-trail purpose as the earlier per-phase specs.

## Files added

- `ncm.js` — local NCM store, identity, import/create/link, save lifecycle, remote-change merge, all rendering (lists, workspace panel, at-a-glance, auto-summary, role tabs, compare, full record, modals), filters, keyboard shortcuts.
- `ncm-sync.js` — pure networking: Apps Script API calls (mirrors `ncm-backend.gs` 1:1), outbox (pending mutation queue), polling.
- `ncm.css` — all NCM styling, built entirely from the existing `styles.css` design tokens (`--color-*`, `--card-*`, `--text-*`), so dark/light theme works with zero extra rules.

## Files modified

- `index.html`: replaced the old Excel-only NCM table (`#tab-ncm`) with the new workspace shell; added 3 modals (role/name picker, Add Patient, Link to Master); added `<link>`/`<script>` tags; added an "Import to NCM" button to the Patient Details drawer header.
- `dashboard.js`: removed the old `renderNcmTab()` (the new one in `ncm.js` replaces it — same name, so the old one had to go or it would silently win by load order); removed the now-orphaned `ncm-search-input` listener in `setupTabSearches()`; added an "Import to NCM" button + handler to each Master Registry row; wired the drawer's import button; added `setupNcmWorkspace()` to `initApp()`.

Script load order: `ncm-sync.js` → `ncm.js` → `dashboard.js` (last, since `initApp()` calls `setupNcmWorkspace()`, which must already be defined).

## Data model (client)

`localStorage["ncm_local_data"]` = `{ [patientKey]: ncmRecord }`, one JS object per patient, fields matching `ncm-backend.gs`'s `NCM_HEADERS` exactly (shared fields + `coordinator*`/`resident*` fields + versions). This is the offline-first source of truth the UI renders from; sync (`ncm-sync.js`) reconciles it with the Google Sheet in the background.

`patientKey` derivation is duplicated client-side (`ncmBuildMasterPatientKey`/`ncmNormalizeKey` in `ncm.js`) to exactly match the server's `buildMasterPatientKey_`/`normalizeKey_` in `ncm-backend.gs` — both must produce identical keys for the same patient or dedup breaks. If the identity algorithm ever changes, it must change in both files together.

## Save lifecycle (implemented exactly as specified)

Edit → local state only (`ncmState.draft`) → **Save** button → write to local store immediately → queue outbox mutation → attempt background sync. Status shown: `Saving locally...` → `Pending Sync` (honest — never flips to `Synced` until `ncm-sync.js` gets back `{success:true}` from the actual Apps Script call). With no backend configured yet (`NCM_CONFIG.apiUrl` empty), status sits at `Pending Sync` forever, which is correct, not a bug.

## Concurrency

`updateCoordinator`/`updateResident` mutations carry `expectedVersion` (the record's last known `coordinatorVersion`/`residentVersion`). A `{conflict:true}` response from the backend surfaces `ncmRenderConflictBanner()` with "Reload Server Version" / "Keep My Changes (Save as New Version)" — never a silent overwrite. Coordinator and Resident fields are written by separate backend actions, so concurrent edits from different roles never touch the same columns.

## Config needed before real multi-user use

`ncm-sync.js`'s `NCM_CONFIG.apiUrl` / `NCM_CONFIG.token` are empty by default — the app works fully offline/local-only until these are filled in with the values from the user's deployed `ncm-backend.gs` (see `google-apps-script/README.md`). Nothing else needs to change; `ncmSyncIsConfigured()` gates all network activity.

## What was verified (local-only, no live Apps Script deployment available in this environment)

Import (including duplicate-prevention), manual NCM-only creation + `NCM Only` badge, Coordinator/Resident field isolation, Compare view, filters, prev/next-capable list, local persistence across reload, dark/light theme, no console errors, no regressions in Phases 1–4 (Operational KPIs, Workload & Capacity, Snapshot History, Daily Digest). One real bug was found and fixed during testing: a missing `ncmUpdateSyncStatusUI` function.

**Not verified** (requires an actual deployed Apps Script + Google Sheet, which only the user can create): the real network round-trip, live polling against a second browser, and an actual version conflict from two concurrent real users. The client code implements the full contract designed in Phase A and documented in `google-apps-script/test-requests.md`; once the user deploys and fills in `NCM_CONFIG`, this should be tested with two browser sessions before relying on it for a real meeting.
