# NCM Backend — Setup & Deployment

Phase A of the NCM Collaborative Workspace feature. This backend is a Google Apps Script Web App backed by a Google Sheet. It does **not** touch the main OncoCoord app or the Excel tracker — it's a separate, independent piece of infrastructure that later phases will wire the NCM UI to.

## 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet. Name it something like `OncoCoord NCM Data`.
2. You don't need to create the `NCM` / `NCM_Audit` tabs or headers by hand — the script creates them automatically on first use.

## 2. Add the script

1. In the spreadsheet, go to **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` content.
3. Copy the entire contents of [`ncm-backend.gs`](./ncm-backend.gs) from this repo and paste it in.
4. Click the disk icon (or Ctrl/Cmd+S) to save. Name the project (e.g. `OncoCoord NCM Backend`).

## 3. Set the shared token (do this before real use)

The endpoint has no real per-user authentication (see "Security note" below) — a shared token is a minimal deterrent against casual/drive-by access.

1. In the Apps Script editor, go to **Project Settings** (gear icon) → **Script Properties**.
2. Add a property named `SHARED_TOKEN` with a long random value you generate yourself (e.g. run `Utilities.getUuid()` once in the Apps Script editor's console, or use any password generator).
3. **Do not commit this value anywhere in the repo.** It gets configured into the client app separately in a later phase, as a build-time/config constant — never hardcoded into `ncm-backend.gs` itself.

Until you set this property, the backend accepts requests with no token (useful for initial `curl` testing below).

## 4. Deploy as a Web App

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" → **Web app**.
3. Settings:
   - **Execute as:** Me (your account)
   - **Who has access:** Anyone
4. Click **Deploy**. Authorize the requested permissions when prompted (this script only touches its own bound spreadsheet).
5. Copy the **Web app URL** shown — it looks like `https://script.google.com/macros/s/AKfycb.../exec`. You'll need this for testing now and for the client config in a later phase.

Whenever you edit the script after this, use **Deploy → Manage deployments → edit (pencil) → New version** to publish changes to the same URL — creating a brand new deployment gives you a different URL.

## 5. Test it

See [`test-requests.md`](./test-requests.md) for ready-to-run `curl` commands covering every action. Run through all of them before building anything on top of this backend.

## Security note

Apps Script Web Apps deployed as "Anyone" have no real per-request authentication — there is no server of your own to hold a proper secret, which is inherent to a fully client-side app like OncoCoord. The `SHARED_TOKEN` above is a deterrent, not real security: once a later phase wires this into `dashboard.js`, the token will be visible in that public JavaScript file on GitHub Pages to anyone who looks. It stops casual scraping/discovery, not a determined actor. Do not store anything more sensitive than what's already in the Excel tracker in this Sheet.

## Data location

All NCM data lives in the Google Sheet you created in step 1 — in the `NCM` and `NCM_Audit` tabs (auto-created on first request). You own and control this Sheet directly; it is separate from the Excel tracker and from this GitHub repo.
