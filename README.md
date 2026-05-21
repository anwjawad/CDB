# Oncology Patient Coordination Dashboard (GitHub Pages Static Version)

This directory contains the standalone, serverless version of the Oncology Patient Coordination & Monitoring System dashboard. It is fully compatible with GitHub Pages hosting.

## How it Works
Unlike the local Flask version which uses a Python backend to download and parse Excel sheets from OneDrive, this version runs **entirely in the user's web browser**:
- **Client-Side Parsing:** Uses the powerful [SheetJS](https://sheetjs.com/) library to read and extract patient tracking tables directly from local `.xlsx` files.
- **Secure Local Caching:** Saves the parsed patient data, clinic nurse lists, and metadata directly in your browser's secure HTML5 `LocalStorage`. No patient information is ever sent to or processed by a remote server.
- **Dynamic Updates:** You can upload new Excel trackers at any time using the "Upload Excel Tracker" button. The dashboard, KPIs, and reports will instantly refresh.

## How to Deploy on GitHub Pages
1. Push this directory or the whole project to a GitHub repository.
2. In your repository settings, go to **Settings** > **Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Choose your branch (e.g., `main`) and select the `/github_pages` folder (or root, if you push only the contents of this folder to a separate branch).
5. Click **Save**. Your site will be live at `https://<your-username>.github.io/<your-repo-name>/`.

## Excel Requirements
The uploaded Excel sheet must have the same sheet names and structures as the system coordination template:
1. **"Tracking sheet":** The sheet containing patient records. The parser automatically scans rows and detects headers containing "Patient Name" or "اسم المريض".
2. **"Lists":** The sheet containing the reference dropdown lists for coordinators, clinics, and divisions.
