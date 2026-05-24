# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OncoCoord v3** — a fully serverless, client-side oncology patient coordination dashboard. There is no backend, build step, or package manager. The app runs entirely in the browser and can be hosted on GitHub Pages or any static file server.

## Running the App

Open `index.html` directly in a browser, or serve the three files (`index.html`, `styles.css`, `dashboard.js`) from any static HTTP server. There is no `npm install`, no compilation, and no dev server required.

For local testing with CORS-free file access, use a simple server:
```
python -m http.server 8080
```
Then open `http://localhost:8080`.

## Architecture

The entire application is three files:

- **`index.html`** — static shell with all tab sections, tables, modals, and the patient-detail drawer pre-rendered in HTML. Dynamic content targets (`<tbody id="...">`, KPI value spans, badge counts) are populated by JavaScript.
- **`styles.css`** — CSS custom properties-based design system. Dark/light theme switching is done by toggling `.dark-theme` / `.light-theme` on `<body>`. All color tokens, spacing, and layout are CSS variables defined in `:root`.
- **`dashboard.js`** — all application logic. No frameworks, vanilla JS only.

### Data Flow

1. On load, JS attempts to fetch the OneDrive sharing link (`DEFAULT_ONEDRIVE_SHARE_URL`) via `fetch()`, converts it to a direct download URL, then parses the binary `.xlsx` using **SheetJS** (`XLSX` global from CDN).
2. Parsed patient rows are stored in `patientsData[]` (global array of raw Excel row objects). `dropdownLists` holds the reference lists from the "Lists" sheet.
3. All filtering, search, analytics, and rendering reads from `patientsData[]` — no secondary data store.
4. Parsed data is cached to `localStorage` under key `dashboard_static_data` as JSON. On next load, the cached data is shown immediately while a background re-fetch occurs.
5. Auto-refresh runs every 5 minutes via `setInterval` stored in `remoteRefreshTimer`.

### Key Mapping (`KEY_MAP`)

Because the Excel tracker headers may vary (English/Arabic, trailing spaces), every field access goes through `getPatientVal(pat, type)` which tries each alias in `KEY_MAP[type]` in order. **Never access `pat['Column Name']` directly** — always use `getPatientVal` or `getEscapedPatientVal`.

### Value Normalization

`normalizeValue()` strips whitespace, lowercases, and Unicode-normalizes before any comparison. Status comparisons (`isPendingValue`, `isYesValue`, `isApprovedValue`, etc.) use the `VALUE_ALIASES` map which covers both English and Arabic equivalents. Always use these helpers when checking field values.

### CDN Dependencies (no local copies)

- **Chart.js** — bar/doughnut/pie charts in the Overview tab
- **SheetJS (`xlsx@0.18.5`)** — client-side `.xlsx` parsing
- **FontAwesome 6.4** — icons
- **Google Fonts** — Outfit (Latin UI) + Tajawal (Arabic text)

The app will show a toast error and degrade gracefully if Chart.js or SheetJS fail to load.

## Excel Workbook Requirements

The tracker workbook must have exactly these sheet names:
- **"Tracking sheet"** — patient records; headers auto-detected by scanning for "Patient Name" or "اسم المريض"
- **"Lists"** — coordinator/clinic/division dropdown reference data

The parser (`parseExcelData`) reads the "Tracking sheet" starting from the first row that contains a recognized patient-name header, so leading metadata rows above the header are safe.

## Analytics Rules

The Smart Analytics tab applies 9 rule sets to `patientsData[]`. Each rule is a filter predicate over normalized field values. When adding or modifying analytics rules, the pattern is:

```js
const matches = patientsData.filter(pat => {
    const field = getPatientVal(pat, 'fieldKey');
    return isXxxValue(field) && ...;
});
```

Update both the count badge (`akpi-val-N`) and the table body (`analytics-tbody-N`) together.

## Theme System

Theme is toggled by `toggleTheme()` which swaps `.dark-theme` / `.light-theme` on `document.body` and saves to `localStorage['theme']`. All visual variants are handled purely in CSS via the class — no JS style manipulation.

## Available Project Skills

Invoke with `/skill-name` in Claude Code. All skills are project-scoped in `.claude/skills/`.

### UI/UX & Design
- `frontend-design` — General frontend design guidance (Anthropic)
- `web-design-guidelines` — Web design best practices (Vercel)
- `ui-ux-pro-max` — Advanced UI/UX methodology
- `high-end-visual-design` — Premium visual design taste
- `design-taste-frontend` — Frontend design taste principles
- `minimalist-ui` — Minimalist UI patterns
- `industrial-brutalist-ui` — Industrial/brutalist UI style
- `stitch-design-taste` — Stitch/Google Labs design taste
- `extract-design-system` — Extract a design system from existing UI
- `emil-design-eng` — Emil Kowalski design engineering patterns
- `shadcn` — shadcn/ui component patterns *(run manually if missing)*

### Frontend & Web Frameworks
- `vercel-react-best-practices` — React best practices (Vercel)
- `vercel-composition-patterns` — React composition patterns (Vercel)
- `vercel-react-native-skills` — React Native patterns (Vercel)
- `deploy-to-vercel` — Deploy to Vercel
- `next-best-practices` — Next.js best practices
- `react:components` (installed as `react-components`) — React component patterns (Google/Stitch)
- `web-artifacts-builder` — Build web artifacts (Anthropic)
- `better-auth-best-practices` — better-auth integration

### Databases & Backend
- `supabase` — Supabase integration
- `supabase-postgres-best-practices` — Postgres best practices with Supabase
- `firebase-basics` — Firebase fundamentals
- `firebase-auth-basics` — Firebase Authentication
- `firebase-hosting-basics` — Firebase Hosting
- `firebase-app-hosting-basics` — Firebase App Hosting
- `firebase-data-connect` — Firebase Data Connect
- `convex-quickstart` — Convex quickstart
- `convex-setup-auth` — Convex auth setup
- `convex-performance-audit` — Convex performance audit

### Files & Data Processing
- `xlsx` — Excel/XLSX file handling (Anthropic)
- `pdf` — PDF processing (Anthropic)
- `docx` — Word document handling (Anthropic)
- `pptx` — PowerPoint handling (Anthropic)

### Microsoft Azure
- `azure-ai` — Azure AI services
- `azure-storage` — Azure Storage
- `azure-deploy` — Azure deployment
- `azure-compute` — Azure Compute
- `azure-cost` — Azure cost management *(closest match to azure-cost-optimization)*
- `appinsights-instrumentation` — Azure Application Insights *(closest match to azure-observability)*

### Marketing & SEO
- `seo-audit` — SEO audit
- `ai-seo` — AI-driven SEO
- `copywriting` — Copywriting guidance
- `content-strategy` — Content strategy
- `signup` — Signup flow optimization
- `cro` — Conversion rate optimization *(signup + cro replace signup-flow-cro)*

### AI & ComfyUI Media
- `image-to-video` — Image-to-video generation (RunComfy)
- `image-inpainting` — Image inpainting (RunComfy)
- `video-inpainting` — Video inpainting (RunComfy)
- `flux-2-klein` — Flux 2 Klein image generation (RunComfy)
