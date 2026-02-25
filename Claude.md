# Historical Events Research Database — Project Guide

## What This Project Is
A wiki-style historical research database focused on controversial, censored, or under-reported topics. The goal is to be an all-in-one home base so researchers don't have to hunt across dozens of websites. Users can upload sources, tag events, and explore connections between people, organizations, and events.

---

## Main File
`/Users/mac/Desktop/Claude research app/historical-events-v2.2.html`
This is the only file that gets deployed. Everything — all HTML, CSS, and JavaScript — lives in this single file. Old saved versions are in the `old-versions/` subfolder. Always work on v2.2.

---

## Tech Stack (No Build Tools)
- **React 18.2** — loaded from CDN, no npm or bundler
- **Babel Standalone 7.23.5** — converts JSX to plain JS directly in the browser
- **vis-network 9.1.6** — draws the network/relationship graph view
- **SheetJS (xlsx) 0.18.5** — reads and exports Excel/spreadsheet files
- **Plain CSS** — written as an inline `<style>` block inside the HTML file
- **Google Fonts** — Space Mono and Karla typefaces
- **Supabase** — cloud database where all events are stored and synced
- **Python backend (FastAPI)** — hosted on Render, handles AI analysis, video transcription, PDF/image text extraction

Because there's no build step, any change to the HTML file is immediately the new version.

---

## Deployment
- **Frontend:** Netlify auto-deploys from GitHub → https://historical-events-databse.netlify.app/
- **Backend:** Render → https://historical-events-api-n45u.onrender.com (free tier — sleeps after 15 min of no use, wakes up on next request which takes ~30 sec)
- **To go live:** `git add historical-events-v2.2.html && git commit -m "..." && git push origin main`
- **To roll back:** `git revert HEAD` or `git revert <commit-hash>`
- **See history:** `git log --oneline`

---

## Architecture Notes
- `FiltersComponent` is defined **outside** the App function — this is intentional to prevent it from re-mounting every time the user types
- All state that needs to survive re-renders (accountTab, myFilters, myPageTab, etc.) lives inside the main App function
- There are **two separate instances** of FiltersComponent: one for the global app and one inside the Account page's "My Uploads" tab — they must always stay in sync (see Key Rules below)

---

## Auth System
- 3 roles: **owner** (full access) > **admin** > **user**
- Hardcoded test accounts in `HARDCODED_USERS` constant: owner/owner123, admin/admin123, testuser/test123
- Real registered users are saved in browser localStorage under `hdb_users`
- Active session stored in localStorage under `hdb_session`
- Credentials reference saved in `accounts.txt` in the project folder

---

## Upload System
There are two ways to add content:

### 1. File Upload (spreadsheets, documents, images)
Handled by `handleFileUpload()`. Supports:
- **Excel (.xlsx/.xls)** and **CSV** — uses a hybrid column-mapping system (see below)
- **TXT** — stores the raw text as a description
- **PDF, Word (.docx), images** — sent to the Python backend for text extraction via `/api/upload`

### 2. URL / Video Upload
Handled by `handleUrlSubmit()`. Supports:
- Any web page URL — backend scrapes the page content
- YouTube and other video URLs — backend downloads captions or transcribes audio using Whisper, extracts video frames using OpenCV
- Optional timestamp range (start/end time) to analyze only part of a video
- Optional "analysis focus" field to tell the AI what to look for

### Auto AI Analysis Toggle
- When **ON**: AI analysis runs automatically as soon as something is uploaded
- When **OFF**: A suggestion popup appears after every upload asking if the user wants AI analysis (see below)

---

## Spreadsheet Column Mapping (Hybrid System)
When an Excel or CSV file is uploaded, the app tries to map each column to a known field using two passes:

1. **Rigid pass (original system):** checks exact known column names like `title`, `Title`, `TITLE`, `date`, `Date`, etc.
2. **Flexible/fuzzy pass (added later):** if the rigid pass finds nothing for a field, it normalizes the column name (lowercase, no spaces/dashes) and checks a wider list of variants — e.g. `"Event Name"` → maps to title, `"Summary"` → maps to description, `"Year"` → maps to date

Both systems run on every row simultaneously — a single row can use rigid matching for one field and fuzzy matching for another. This is handled by the `resolveField(row, rigidKeys, fuzzyVariants)` helper function.

If a row can't resolve either a title or a date from either system, it's flagged as `_isUnformatted: true`.

**Fields mapped:** title, description, date, topics, people, organizations, link, research level

---

## AI Analysis Suggestion Popup
After any upload completes (file or URL), if Auto AI Analysis is OFF, a blue suggestion card appears at the top of the upload area with:
- A message explaining what was uploaded
- A special note if the spreadsheet had unformatted/unmapped rows
- **"Analyze with AI"** button — runs `triggerBulkAnalysis()` for backend files
- **"View Upload"** button — opens the event detail modal
- **"Skip"** button — dismisses
- Red × button in top-right corner to close manually
- Auto-dismisses after 30 seconds

The `triggerBulkAnalysis(events)` function handles the actual AI analysis loop — it's shared between the Auto AI Analysis path and the suggestion popup.

---

## Account Page / My Uploads Tab
- Has its own separate filters state (`myFilters`) with the same shape as the global filters
- Has its own page view state (`myPageTab`)
- `accountScopedData` is passed to the filter component so checkboxes only show that user's own topics/people/orgs
- Uses a separate network graph div: `my-network-graph` (the main one is `network-graph`)
- The "Upload" button inside My Uploads redirects to the main Upload tab

---

## Video Analysis (Backend Pipeline)
- Backend file: `video_analyzer.py`
- Extracts video metadata first (title, uploader, duration) without downloading
- Uses YouTube captions when available; falls back to downloading + Whisper transcription
- Extracts video frames using OpenCV from a stream URL
- Saves frames to `downloads/frames/`, transcripts to `downloads/transcripts/`, attachments to `downloads/attachments/`
- Backend API endpoints: `/api/frames/`, `/api/transcripts/`, `/api/attachments/` (GET/POST/DELETE), `/api/analyze-url`, `/api/upload`, `/api/analyze/<id>`

---

## UI Conventions
- **Always add an (i) tooltip** next to any non-obvious button, toggle, or input
- Use existing CSS classes: `.tooltip-wrapper` and `.tooltip-content`
- (i) circle style: `width/height 18px, borderRadius 50%, background rgba(96,165,250,0.2), border 1px solid rgba(96,165,250,0.4), color #60a5fa, fontSize 0.7rem, fontWeight 700`
- Tooltip box: `background rgba(15,18,35,0.97), border 1px solid rgba(96,165,250,0.3), borderRadius 10px, padding 0.75rem 1rem, width 260-280px, fontSize 0.78rem`
- Tooltips open upward (`bottom: 100%`). Use `right: 0` if near the right edge of the screen

---

## Key Rules
1. **Filters & Pages parity:** Any change to the Filters section or Pages nav must be applied to BOTH the global app AND the "My Uploads" tab inside the Account page. Only skip this if explicitly told to change just one.
2. **Single file:** Do not create new files for features. Everything goes in `historical-events-v2.2.html`.
3. **No build tools:** Do not suggest npm, webpack, or any build process. Everything runs from CDNs.
4. **Always push at end of session** — the user tests on the live Netlify site, not locally.

---

## Known Issues
- **Network view — slow with filters:** When any filter is active, the network graph takes a long time to load
- **Network view — search spaz-out:** When a topic is typed in the manual search box, the network graph creates a chaotic mess of rapidly moving connections that makes it unreadable

---

## Upcoming Features (Not Yet Built)
- **Presentations:** Allow users to build slide-style presentations from the event data
- **UI overhaul:** Make the overall design more polished and modern, especially the timeline and network views
