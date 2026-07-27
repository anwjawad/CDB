# NCM Collaborative Workspace — Phase A: Google Apps Script Backend

## Context
First phase of the "NCM Collaborative Workspace" master feature (full scope in the user's original request, decomposed into phases A–F). This phase delivers ONLY the backend: a Google Apps Script Web App + Google Sheet schema. **Zero changes to `dashboard.js`/`index.html`/`styles.css` in this phase** — no UI wiring yet (that starts Phase B). Verified via `curl`, not via the app.

Role identity decision (from user): no real auth. A later phase (B/C) will add a simple "pick role + name" prompt stored in `localStorage`, sent as the `user`/`role` fields on every write. This backend accepts `user`/`role` as plain request fields — it does not authenticate them.

## Architecture
Single Web App (`doGet`/`doPost` in one `.gs` file), dispatching by an `action` parameter — not per-endpoint deployments. All sheet access goes through a header-name → column-index map built once per request (`getColumnMap_`), never hardcoded column letters/numbers, per the user's explicit requirement.

Two sheet tabs in one Spreadsheet:
- **`NCM`** — one row per patient (schema below).
- **`NCM_Audit`** — append-only mutation log (patientKey, timestamp, user, role, action, changedFields).

## Sheet Schema (`NCM` tab, row 1 = headers)
Adopted near-verbatim from the user's own schema (already well-designed, preserves the one-patient/two-workspaces principle):

```
patientKey, source, masterLinked, patientName, patientFile, patientId, clinic, division,
diagnosis, primaryPhysician, referralType, referralForms, treatmentReferralStatus,
otherReferralStatus, permitSent, permitStatus, clinicVisitDate, chemoDate, otherAppointments,
patientNotified, patientNotifiedOther, barrier, caseStatus,
sharedTreatmentPlan, sharedNotes,
coordinatorBriefHistory, coordinatorTreatmentPlan, coordinatorNotes, coordinatorMeetingNotes,
coordinatorDecision, coordinatorStatus, coordinatorVersion, coordinatorUpdatedAt, coordinatorUpdatedBy,
residentBriefHistory, residentAssessment, residentTreatmentPlan, residentNotes, residentMeetingNotes,
residentDecision, residentStatus, residentVersion, residentUpdatedAt, residentUpdatedBy,
createdAt, createdBy, updatedAt
```

`NCM_Audit` tab: `timestamp, patientKey, user, role, action, changedFields`.

## Patient Identity
`patientKey` for Master-imported patients = `normalizeKey_(patientId) + "|" + normalizeKey_(patientFile)` (both trimmed/lowercased/whitespace-collapsed; falls back to normalized `patientName` alone if both id and file are empty — matches the app's existing `groupPatients()` fallback chain in `dashboard.js`). For manual NCM-only patients: `"manual-" + Utilities.getUuid()`. `link` action later attaches real identity fields to a manual row WITHOUT changing its `patientKey` (avoids breaking any client-side references already pointing at that key) — it sets `masterLinked = true` and fills `patientId`/`patientFile` for display/badge purposes.

## API (all responses: `{ success: bool, data?, error?, conflict?, server? }` as JSON)

| Method | `action` | Purpose |
|---|---|---|
| GET | `list` | All NCM rows, list-view fields only |
| GET | `get` | One row by `patientKey` |
| GET | `changes` | Rows with `updatedAt` after `since` (ISO string) — polling |
| POST | `import` | Import Master patient; dedup by `patientKey`; returns existing row untouched if already present |
| POST | `createManual` | Create NCM-only patient with provisional key |
| POST | `link` | Attach real identity to a manual row |
| POST | `updateShared` | Update shared fields (`sharedTreatmentPlan`, `sharedNotes`, `caseStatus`, `barrier`) |
| POST | `updateCoordinator` | Update `coordinator*` fields only, optimistic-concurrency checked |
| POST | `updateResident` | Update `resident*` fields only, optimistic-concurrency checked |

All POST bodies are JSON (`e.postData.contents`). All writes wrapped in `LockService.getScriptLock()`.

**Optimistic concurrency:** `updateCoordinator`/`updateResident` require `expectedVersion` in the request. Server compares to the row's current `coordinatorVersion`/`residentVersion`; on mismatch, returns `{ success: false, conflict: true, server: <current row> }` and writes nothing (never silently overwrites). On match: applies fields, increments the version, sets `<role>UpdatedAt`/`<role>UpdatedBy` and the row's top-level `updatedAt`, appends one `NCM_Audit` row, returns the updated row.

## Security (honest limitation, documented for the user)
Apps Script Web Apps deployed as "Execute as: Me / Anyone" have no per-request authentication — this is inherent to a client-side-only app calling a public endpoint (no server to hold a real secret, as the user's own request already acknowledges). Mitigation used here: a `SHARED_TOKEN` **Script Property** (set via the Apps Script editor's Project Settings → Script Properties, never committed to the repo) that every request must pass as a `token` field; requests with a missing/wrong token are rejected before touching the sheet. This is a deterrent (keeps the endpoint from being casually discoverable/scraped), not real authentication — the token will still be visible in the public `dashboard.js` once wired in a later phase, so it does not protect against a determined actor. This is stated plainly in the deployment instructions.

Server-side validation: every write validates required fields are present and `patientKey` is well-formed before touching the sheet; unknown `action` values return a clean error instead of a stack trace.

## Deliverables for this phase
1. `google-apps-script/ncm-backend.gs` — complete source, committed to the repo (for version history/reference; the actual runtime copy lives in the user's Apps Script project, pasted manually).
2. `google-apps-script/README.md` — step-by-step: create Sheet → add tabs/headers → open Apps Script editor → paste code → set `SHARED_TOKEN` script property → Deploy as Web App (Execute as Me, Anyone has access) → copy the deployment URL.
3. `google-apps-script/test-requests.md` — ready-to-run `curl` commands covering every action, including a deliberate duplicate-import and a deliberate version-conflict, so the backend can be verified end-to-end before any UI is built on top of it.

## Out of scope (later phases)
UI wiring, role picker, outbox/pending-sync, live polling integration, conflict UI, Compare view — all Phase B onward.
