# Browser Extension Update Procedures

## Overview
This document outlines the standard procedure for updating the Historical Events Database browser extension and syncing changes to the Research Companion page.

---

## When There's an Extension Update

### Step 1: Build the New Extension
1. Update the extension source files in `extension-working/chrome-extension/`
2. Update the version number in `manifest.json` (e.g., 1.2.0 → 1.3.0)
3. Commit changes to git with detailed commit message

### Step 2: Create Distribution Zip
```bash
cd extension-working
zip -r ../hdb-extension-v[VERSION].zip chrome-extension/
cd ..
```
- Example: `hdb-extension-v1.2.0.zip`

### Step 3: Update Research Companion Page
1. Open `/Users/mac/Desktop/Claude research app/research-companion.html`
2. Find the **"Extension Setup & Install"** section (search for "hdb-extension")
3. **Replace the download link** with the new zip filename:
   ```
   OLD: hdb-extension-v1.1.0.zip
   NEW: hdb-extension-v1.2.0.zip
   ```
4. If the instructions changed, **update the "How to Use"** section below the download link

### Step 4: Update Companion Page in Production
1. Commit the updated `research-companion.html` to git:
   ```bash
   git add research-companion.html
   git commit -m "Update extension to v1.2.0 in Research Companion page"
   ```
2. Since the Companion page is hosted on Netlify (same as the main app), it auto-deploys from GitHub
3. Verify the changes live at: https://historical-events-databse.netlify.app/research-companion.html

### Step 5: Update Memory & Documentation
1. Update `/Users/mac/.claude/projects/-Users-mac-Desktop-Claude-research-app/memory/MEMORY.md`:
   - Change the Browser Extension version line
   - Update the features list if applicable
2. Keep this procedures document synchronized with any workflow changes

---

## Quick Reference: Update Checklist

- [ ] Update source files in `extension-working/chrome-extension/`
- [ ] Bump version in `manifest.json`
- [ ] Create new zip: `hdb-extension-vX.Y.Z.zip`
- [ ] Update download link in `research-companion.html`
- [ ] Update "How to Use" section if instructions changed
- [ ] Commit both files to git
- [ ] Update MEMORY.md version reference
- [ ] Verify changes are live on Netlify

---

## Extension File Structure

```
extension-working/chrome-extension/
├── manifest.json        ← Update version here
├── popup.html           ← Extension UI
├── popup.js             ← Extension logic
├── popup.css            ← Extension styles
├── content.js           ← Page interaction script
├── background.js        ← Service worker
├── content.css          ← Page styles
└── icons/               ← Icon files (usually don't change)
```

---

## Deployment Timeline

1. **Development**: Edit `extension-working/chrome-extension/`
2. **Package**: Create `hdb-extension-vX.Y.Z.zip`
3. **Sync**: Update `research-companion.html`
4. **Commit**: Push both to GitHub
5. **Deploy**: Netlify auto-deploys
6. **Live**: Available at Research Companion URL

---

## Notes

- The zip file is a distribution artifact — keep all versions for rollback purposes
- The Research Companion page auto-deploys from GitHub (Netlify integration)
- Test the extension locally before committing (load unpacked in Chrome)
- The toggle feature (v1.2.0) allows users to disable "Save to DB" popups temporarily
