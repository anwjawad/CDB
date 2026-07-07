# Oncology Patient Coordination Dashboard (GitHub Pages Static Version)

This directory contains the standalone, serverless version of the Oncology Patient Coordination & Monitoring System dashboard. It is fully compatible with GitHub Pages hosting.

## How it Works
Unlike the local Flask version, this version runs **entirely in the user's web browser**:
- **Default OneDrive Source:** On startup, the dashboard downloads the shared OneDrive Excel tracker from `https://1drv.ms/x/c/18fa9d20cfad9d46/IQAs7EU-f7OiRomVmOE52jlaAQIiC6WHZIH1nZeM1_sVc_M?e=ESQPZq`.
- **Client-Side Parsing:** Uses [SheetJS](https://sheetjs.com/) to read and extract patient tracking tables from the downloaded `.xlsx` workbook.
- **Automatic Refresh:** Refreshes from OneDrive every 5 minutes while the page is open, and also when the browser tab becomes active again.
- **Manual Fallback:** If direct OneDrive browser access is blocked by sharing permissions or CORS, the user can still upload a local `.xlsx` copy.
- **Session-Scoped Caching:** Parsed patient data, clinic nurse lists, and metadata are cached in HTML5 `SessionStorage` so they are automatically discarded when the browser tab/window is closed. Cached patient data is also purged after 20 minutes of inactivity. Only non-sensitive UI preferences (e.g. theme) are kept in `LocalStorage`.

## Current Structure
- `index.html` contains the static application shell, tabs, tables, modals, and drawer markup.
- `styles.css` contains the theme variables, dashboard layout, responsive rules, tables, drawer, toasts, and print styles.
- `dashboard.js` contains the client-side state, Excel parsing, LocalStorage access, filtering, analytics rules, chart rendering, patient search, export, and print workflow.

## Reliability and Privacy Notes
- The browser must be able to load Chart.js and SheetJS from their CDN URLs.
- The OneDrive sharing link must allow anonymous download access for a static browser app to sync it directly.
- Clearing browser storage removes the cached tracker data; the dashboard will try to repopulate from OneDrive on the next load.
- Third-party libraries (Chart.js, SheetJS, FontAwesome) are loaded from pinned CDN versions with Subresource Integrity (SRI) hashes, so the browser refuses to run them if the fetched file has been tampered with.
- Cached patient records are held in `SessionStorage` and are cleared automatically when the tab is closed or after 20 minutes of inactivity; they do not persist across browser sessions. Even so, keep this dashboard hosted and opened only in trusted environments, and close the tab when leaving a shared workstation.

## How to Deploy on GitHub Pages
1. Push this directory or the whole project to a GitHub repository.
2. In your repository settings, go to **Settings** > **Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Choose your branch (e.g., `main`) and select the `/github_pages` folder (or root, if you push only the contents of this folder to a separate branch).
5. Click **Save**. Your site will be live at `https://<your-username>.github.io/<your-repo-name>/`.

## Excel Requirements
The OneDrive workbook or manually uploaded Excel sheet must have the same sheet names and structures as the system coordination template:
1. **"Tracking sheet":** The sheet containing patient records. The parser automatically scans rows and detects headers containing "Patient Name" or "اسم المريض".
2. **"Lists":** The sheet containing the reference dropdown lists for coordinators, clinics, and divisions.
