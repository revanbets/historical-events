# Source Finder — Complete Development Plan

## Feature Overview
"Source Finder" — AI analyzes any uploaded content (videos, podcasts, articles, social media posts, documents) to identify claims and facts, then searches the internet to find the actual sources and primary documents for each claim. Outputs a timestamped (video) or section-by-section (text) list of claims with their sources, key quotes, and source types.

**Core purpose:** Help researchers find the actual information being referenced in controversial/censored content, trace it to primary sources, and build a verifiable research trail — without judging truth, just finding the evidence.

---

## Key Decisions

### Trigger & Scope
- **Separate manual button** — does NOT auto-run with existing AI analysis
- Works on **ALL content types**: videos, podcasts, articles, social media posts, documents, images
- Works on **both new and past events** already in the database
- "Find Sources" button available on event detail modals, cards, rows, timeline items

### Depth Tiers (User Chooses)
1. **Scan** (~1-3 min): Identify claims, basic web search for each
2. **Investigate** (~5-10 min): Find sources + trace to primary documents
3. **Deep Dive** (~10-20 min): Exhaustive search, follow source chains, check archives

### Long Content Handling
- **Podcasts/videos over ~30 min:** Chunk into segments for processing
- Process chunks sequentially or in parallel depending on backend capacity
- Merge results into unified timestamped output

### Search APIs
- **Google Custom Search API** — primary search engine
- **Brave Search API** — secondary/alternative search engine
- **Firecrawl** — web scraping to extract full page content from found URLs

### Loading & Background Processing
- **Loading popup** with estimated time remaining
- **"Continue Browsing" button** — lets user navigate away while search continues in background
- Search does NOT stop when user leaves the page
- **"Cancel" button** — stops launching new searches, finishes any in-progress searches, compiles and saves whatever was found so far
- Background notification/badge when search completes

---

## Output Format

### Videos/Podcasts
- Timestamped claim list synced to video playback
- Each timestamp links to that point in the video (embedded player or external link)

### Text Content (Articles, Posts, Documents)
- Section-by-section breakdown
- Original text displayed with highlighted sections referencing each claim
- If text highlighting needs the browser extension → show popup recommending download with link to setup page

### Source Information (Per Claim)
- Link + page title
- Short summary of what the source says and how it relates to the claim
- Source type label (government doc, news article, academic paper, court record, etc.)
- Key quotes extracted from the source that corroborate the claim
- Primary vs secondary source designation
- If NO source found → flag as "No source found" + suggest manual search terms the user can try

---

## Display Locations

### 1. Event Detail Modal — Summary Tab
- Collapsible source summary section
- Condensed list of claims with top source for each
- Link to open full source viewer

### 2. Full-Page Source Viewer — Split Screen
- **Left side:** Original content (embedded video player OR scrollable text)
- **Right side:** Timestamped/sectioned source list
- **Sync:** As user plays video or scrolls text, source list stays in sync
- Embedded player when platform supports it, external timestamp link as fallback

### 3. Event Cards/Rows/Timeline — Source Badge
- Small badge + source count (e.g., "12 sources") on events that have been source-checked
- Visible at a glance across all views (spreadsheet, timeline, grid, etc.)

---

## Interactivity

### Save Sources as Events
- Button per source result to save it as a new event in the database
- Automatically creates parent-child "source" relationship with original event
- Source relationships visible as connections in the network graph view

### Annotations
- Users can add personal notes/annotations to individual claims
- Notes saved to Supabase, visible to the user

### Re-Search (Per Claim)
- **Refined search:** Text input where user adds keywords/context to guide a deeper search (e.g., "look for the original court filing" or "find the declassified document")
- **Auto deep-dive:** Button that triggers AI to automatically try harder — follow links, check archives, try alternative search terms — no user input needed

### Manual Source Addition
- Users can manually add their own found sources alongside AI results
- Form with URL, title, notes fields

---

## Multi-User & Collaboration

- **Collaborative sourcing:** Multiple users can run source-finding on the same event
- All found sources merged into one list, attributed to who found them
- Users can also manually add their own sources
- Builds a community-sourced verification record

---

## Architecture

### New Backend Endpoints (add to analysis/main.py)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/source-find` | POST | Main: accepts event ID + depth tier, extracts claims, searches web, returns structured sources |
| `/api/source-find/status/{search_id}` | GET | Check status of ongoing background search |
| `/api/source-find/cancel/{search_id}` | POST | Cancel search, compile partial results |
| `/api/source-find/claim/{claim_id}` | POST | Re-search a specific claim with optional user context |
| `/api/sources/{event_id}` | GET | Get all sources for an event |
| `/api/sources/{event_id}/manual` | POST | Add a manual source |
| `/api/sources/{event_id}/annotate` | POST | Add annotation to a claim |

### New Supabase Tables

#### `source_searches`
Tracks each source-finding run.
```sql
id              UUID PRIMARY KEY
event_id        UUID REFERENCES events(id)
user_id         TEXT NOT NULL
depth_tier      TEXT NOT NULL  -- 'scan', 'investigate', 'deep_dive'
status          TEXT NOT NULL  -- 'running', 'completed', 'cancelled', 'failed'
progress        INTEGER DEFAULT 0  -- percentage complete
estimated_time  INTEGER  -- estimated seconds remaining
total_claims    INTEGER DEFAULT 0
sourced_claims  INTEGER DEFAULT 0
created_at      TIMESTAMPTZ DEFAULT NOW()
completed_at    TIMESTAMPTZ
```

#### `source_claims`
Individual claims extracted from content.
```sql
id              UUID PRIMARY KEY
search_id       UUID REFERENCES source_searches(id)
event_id        UUID REFERENCES events(id)
claim_text      TEXT NOT NULL
timestamp_start FLOAT  -- seconds (for video/audio)
timestamp_end   FLOAT  -- seconds (for video/audio)
section_index   INTEGER  -- for text content
section_text    TEXT  -- original text section containing the claim
order_index     INTEGER NOT NULL
status          TEXT DEFAULT 'pending'  -- 'pending', 'searching', 'found', 'not_found'
search_terms    TEXT[]  -- suggested manual search terms if not found
created_at      TIMESTAMPTZ DEFAULT NOW()
```

#### `source_results`
Found sources for each claim.
```sql
id              UUID PRIMARY KEY
claim_id        UUID REFERENCES source_claims(id)
event_id        UUID REFERENCES events(id)
user_id         TEXT NOT NULL
url             TEXT NOT NULL
title           TEXT
summary         TEXT
source_type     TEXT  -- 'government_doc', 'news', 'academic', 'court_record', 'book', 'interview', 'archive', 'other'
key_quotes      JSONB  -- array of quote strings
is_primary      BOOLEAN DEFAULT FALSE
found_by_ai     BOOLEAN DEFAULT TRUE
manual_notes    TEXT
saved_as_event  UUID  -- if saved as a new event, link to it
created_at      TIMESTAMPTZ DEFAULT NOW()
```

#### `source_annotations`
User notes on claims.
```sql
id              UUID PRIMARY KEY
claim_id        UUID REFERENCES source_claims(id)
user_id         TEXT NOT NULL
note_text       TEXT NOT NULL
created_at      TIMESTAMPTZ DEFAULT NOW()
updated_at      TIMESTAMPTZ DEFAULT NOW()
```

### Frontend Components (all in historical-events-v2.2.html)

1. **"Find Sources" button** — on event detail modals, event cards, spreadsheet rows, timeline items
2. **Depth selector popup** — Scan / Investigate / Deep Dive picker with descriptions and time estimates
3. **Loading popup** — progress bar, estimated time, "Continue Browsing" button, "Cancel" button
4. **Source summary section** — collapsible section in event detail modal
5. **Full source viewer page** — split-screen with embedded player/text + source list
6. **Source badge** — count badge on event cards/rows/timeline showing "X sources"
7. **Save-as-event button** — per source result, creates linked child event
8. **Annotation input** — per claim, saves to Supabase
9. **Re-search controls** — per claim: text input for refined search + auto deep-dive button
10. **Manual source add form** — URL + title + notes in source viewer

### Pipeline Flow
```
User clicks "Find Sources" on an event
  → Depth tier selector popup appears (Scan / Investigate / Deep Dive)
  → User picks tier
  → Loading popup appears with progress bar + estimated time
  → User can click "Continue Browsing" to navigate away (search continues)
  → Backend receives event content + depth tier
  → Step 1: Chunk long content if needed (30-min segments for video)
  → Step 2: AI extracts claims/facts from content (transcript, text, etc.)
  → Step 3: For each claim, construct optimized search queries
  → Step 4: Search via Google Custom Search + Brave Search APIs
  → Step 5: Scrape top results with Firecrawl to get full page content
  → Step 6: AI analyzes scraped pages, extracts relevant info, key quotes
  → Step 7: AI classifies source type, determines primary vs secondary
  → Step 8: Save structured results to Supabase
  → Step 9: Notify user (badge/notification) when complete
  → Frontend displays in modal summary + full page view

Cancel flow:
  → User clicks "Cancel"
  → Backend finishes any in-progress claim searches
  → Compiles and saves whatever was found so far
  → Returns partial results with status "cancelled"
```

---

## Development Stages

### Stage 1: Backend Pipeline & Data Layer
- Create new Supabase tables (source_searches, source_claims, source_results, source_annotations)
- Build `/api/source-find` endpoint with claim extraction via Claude
- Integrate Google Custom Search API + Brave Search API
- Integrate Firecrawl for page scraping
- Implement depth tier logic (Scan/Investigate/Deep Dive)
- Add chunking for long content (30-min video segments)
- Build background processing with status tracking
- Build cancel endpoint that compiles partial results
- Build `/api/source-find/status/{search_id}` for progress polling

### Stage 2: Frontend — Find Sources Button & Modal Summary
- "Find Sources" button on event detail modals (and cards/rows/timeline)
- Depth tier selector popup (Scan / Investigate / Deep Dive)
- Loading popup with progress bar, estimated time remaining, "Continue Browsing" button, "Cancel" button
- Background search notification when complete
- Source summary section in event detail modal (collapsible)
- Basic source display: link, title, summary, source type, key quotes, primary/secondary label
- "No source found" flagging with suggested search terms
- Source count badge on event cards/rows/timeline

### Stage 3: Full Source Viewer Page
- Split-screen layout (content left, sources right)
- Embedded video player (YouTube/etc) with timestamp click-to-jump
- External timestamp link fallback for non-embeddable platforms
- Text content display with section highlighting
- Scroll/play synchronization between content and source list
- Browser extension recommendation popup for text highlighting (with link to setup page)

### Stage 4: Interactivity — Save, Annotate, Re-search
- Save source as new event with parent-child "source" relationship
- Network graph integration — source relationships visible as connections
- Annotation/notes input per claim (saved to Supabase)
- Re-search: refined search with user text input per claim
- Re-search: automatic deep-dive button per claim
- Manual source addition form (URL + title + notes)

### Stage 5: Collaboration & Polish
- Multi-user source-finding on same event with merged results
- Attribution — show who found each source
- Manual source addition by any user
- Performance optimization for large source lists
- Edge case handling (dead links, paywalled content, rate limiting)
- Final UI polish and responsive design

---

## API Keys Needed
- **Google Custom Search API** — key + custom search engine ID
- **Brave Search API** — API key
- **Firecrawl** — API key (user already has experience with this)
- These should be stored as environment variables on the Render backend

---

## File Locations
- **Frontend:** `/Users/mac/Desktop/Claude research app/historical-events-v2.2.html`
- **Backend:** `/Users/mac/Desktop/Claude research app/analysis/main.py`
- **Video pipeline:** `/Users/mac/Desktop/Claude research app/analysis/video_analyzer.py`
- **This plan:** `/Users/mac/Desktop/Claude research app/SOURCE_SEARCH_PLAN.md`
- **Dev tracker:** Memory file `podcast-sources-feature.md`
