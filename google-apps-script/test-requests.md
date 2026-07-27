# NCM Backend — Test Requests

Replace `URL` below with your deployed Web App URL, and `TOKEN` with your `SHARED_TOKEN` (omit `&token=TOKEN` / `"token":"TOKEN"` entirely if you haven't set one yet during initial testing).

```bash
URL="https://script.google.com/macros/s/XXXXXXXXXXXXXXXX/exec"
TOKEN="your-shared-token"
```

## 1. List (should be empty array on a fresh sheet)

```bash
curl -s "$URL?action=list&token=$TOKEN" | python -m json.tool
```
Expected: `{"success": true, "data": []}`

## 2. Import a Master patient

```bash
curl -s -X POST "$URL" -d '{
  "action": "import",
  "token": "'"$TOKEN"'",
  "user": "Jawad",
  "role": "coordinator",
  "patient": {
    "patientId": "900123456",
    "patientFile": "44128",
    "patientName": "Ahmad Mohammad",
    "clinic": "Onco A",
    "diagnosis": "Lung Cancer",
    "primaryPhysician": "Dr. Example"
  }
}' | python -m json.tool
```
Expected: `{"success": true, "existed": false, "data": {...}}` with `patientKey` = `"master:900123456|44128"`.

## 3. Import the SAME patient again (dedup check)

Run the exact same command as step 2 again.

Expected: `{"success": true, "existed": true, "data": {...}}` — **same** `patientKey`, and `list` (step 1 repeated) should still show only ONE row, not two.

## 4. Get one patient

```bash
curl -s "$URL?action=get&patientKey=master:900123456|44128&token=$TOKEN" | python -m json.tool
```

## 5. Create an NCM-only (manual) patient

```bash
curl -s -X POST "$URL" -d '{
  "action": "createManual",
  "token": "'"$TOKEN"'",
  "user": "Jawad",
  "role": "resident",
  "patient": {
    "patientName": "Sara Test",
    "briefHistory": "45F, new breast lump, referred from GP",
    "treatmentPlan": "Awaiting biopsy"
  }
}' | python -m json.tool
```
Expected: `{"success": true, "data": {..., "source": "manual", "masterLinked": false, "patientKey": "manual-..."}}`. Save this `patientKey` for the next steps — call it `MANUAL_KEY`.

## 6. Update Coordinator fields (first save, no expectedVersion needed)

```bash
curl -s -X POST "$URL" -d '{
  "action": "updateCoordinator",
  "token": "'"$TOKEN"'",
  "user": "Jawad",
  "role": "coordinator",
  "patientKey": "MANUAL_KEY",
  "fields": { "coordinatorNotes": "Called patient, confirmed contact info." }
}' | python -m json.tool
```
Expected: `{"success": true, "data": {..., "coordinatorVersion": 1, "coordinatorNotes": "Called patient, confirmed contact info."}}`. Confirm `residentBriefHistory` etc. are UNCHANGED from step 5 (role isolation).

## 7. Update Resident fields on the same patient (independent from Coordinator)

```bash
curl -s -X POST "$URL" -d '{
  "action": "updateResident",
  "token": "'"$TOKEN"'",
  "user": "Dr. Resident",
  "role": "resident",
  "patientKey": "MANUAL_KEY",
  "fields": { "residentAssessment": "Likely fibroadenoma, low suspicion." }
}' | python -m json.tool
```
Expected: `residentVersion: 1`. `get` this patient afterward and confirm the Coordinator fields from step 6 are still present (neither update erased the other).

## 8. Version conflict test

First, `get` the patient and note its current `coordinatorVersion` (should be `1` from step 6). Then send an update with a deliberately **stale** `expectedVersion`:

```bash
curl -s -X POST "$URL" -d '{
  "action": "updateCoordinator",
  "token": "'"$TOKEN"'",
  "user": "Second Coordinator",
  "role": "coordinator",
  "patientKey": "MANUAL_KEY",
  "expectedVersion": 0,
  "fields": { "coordinatorNotes": "This should NOT be saved." }
}' | python -m json.tool
```
Expected: `{"success": false, "conflict": true, "server": {...}}` — and a follow-up `get` must show `coordinatorNotes` UNCHANGED from step 6 (the conflicting write must not have applied).

Now retry with the correct current version (`1`):

```bash
curl -s -X POST "$URL" -d '{
  "action": "updateCoordinator",
  "token": "'"$TOKEN"'",
  "user": "Second Coordinator",
  "role": "coordinator",
  "patientKey": "MANUAL_KEY",
  "expectedVersion": 1,
  "fields": { "coordinatorNotes": "This should be saved." }
}' | python -m json.tool
```
Expected: `{"success": true, "data": {..., "coordinatorVersion": 2}}`.

## 9. Link a manual patient to Master identity

```bash
curl -s -X POST "$URL" -d '{
  "action": "link",
  "token": "'"$TOKEN"'",
  "user": "Jawad",
  "role": "coordinator",
  "patientKey": "MANUAL_KEY",
  "patient": { "patientId": "900999888", "patientFile": "50001" }
}' | python -m json.tool
```
Expected: `masterLinked: true`, `patientId`/`patientFile` now set, and `patientKey` is **unchanged** (still `manual-...`).

## 10. Changes / polling

```bash
curl -s "$URL?action=changes&since=2020-01-01T00:00:00.000Z&token=$TOKEN" | python -m json.tool
```
Expected: all rows created/updated above. Then repeat with `since` set to a timestamp a few seconds in the future — expect an empty array.

## 11. Bad token (only meaningful once `SHARED_TOKEN` is set)

```bash
curl -s "$URL?action=list&token=wrong-token" | python -m json.tool
```
Expected: `{"success": false, "error": "Invalid or missing token."}`

## Cleanup

These test rows will sit in your `NCM` sheet — delete them manually from the Sheet (or just leave them; they won't affect anything) before real meeting use.
