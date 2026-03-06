# HistoDB Mobile App

Native iOS/Android app for the Historical Events Research Database. Built with Expo + React Native. Connects to the same Supabase database and Python backend as the web app — all data syncs instantly.

---

## Prerequisites

**Node.js is required.** Install it before anything else:

- Download from https://nodejs.org (choose the LTS version)
- Or with Homebrew: `brew install node`

Verify installation:
```bash
node --version   # should print v18 or higher
npm --version
```

---

## Setup (One Time)

```bash
# 1. Navigate to this folder
cd "/Users/mac/Desktop/Claude research app/mobile-app"

# 2. Install all dependencies
npm install

# 3. Install Expo CLI globally (optional but useful)
npm install -g expo-cli
```

---

## Running the App

### On Your Phone (Easiest)

1. Install **Expo Go** from the App Store or Google Play
2. Run:
   ```bash
   npx expo start
   ```
3. Scan the QR code with your phone camera (iOS) or Expo Go app (Android)

### Share With Friends & Family (No App Store)

**Option A — Same WiFi (Instant)**
```bash
npx expo start
```
Friends install Expo Go, scan your QR code.

**Option B — Any Network (Tunnel)**
```bash
npx expo start --tunnel
```
Generates a public URL. Anyone with Expo Go can open it from anywhere.

**Option C — EAS Build (Best Experience, looks like a real app)**
```bash
npm install -g eas-cli
eas login          # create free Expo account at expo.dev
eas build --platform ios --profile preview
```
This creates a TestFlight build. Share the link — no App Store or developer account needed for TestFlight internal testing.

---

## Publishing to App Store (Long Term)

1. **Apple Developer Account** — $99/year at developer.apple.com
2. Build:
   ```bash
   eas build --platform ios --profile production
   ```
3. Submit:
   ```bash
   eas submit --platform ios
   ```

---

## Login

Use the same credentials as the web app:

| Username | Password | Role |
|----------|----------|------|
| owner | owner123 | Full access |
| admin | admin123 | Admin |
| testuser | test123 | Basic user |

Real registered users from the web app also work automatically.

---

## Research Session — Mobile Workflow

The Chrome browser extension is replaced by two mobile-native methods:

### Method 1: Clipboard Detection (works immediately)

1. Open TikTok / Instagram / YouTube / X
2. Find a video or post you want to research
3. Tap **"..."** → **"Copy Link"** (or similar)
4. Switch back to HistoDB
5. A banner automatically appears: **"[Platform] link detected"**
6. Tap **"Add to Session"** or **"Analyze & Save"**

Works with every platform that has "Copy Link" — which is all of them.

### Method 2: iOS Shortcut (one-tap capture from Share Sheet)

Create a shortcut that lets you tap "Share" in any app and instantly capture to HistoDB:

1. Open the **Shortcuts** app on iPhone
2. Tap **+** → **New Shortcut**
3. Add action: **"Receive" → "URLs"** (accept input from Share Sheet)
4. Add action: **"Open URLs"** → set URL to:
   ```
   histodb://share?url=[Shortcut Input]
   ```
5. Tap **"..."** → **"Add to Share Sheet"**

Now in any app: Share → HistoDB Shortcut → app opens with the URL ready to capture.

### Method 3: iOS Share Extension (coming soon)

A native Share Extension will be added in a future update, allowing HistoDB to appear directly in the iOS Share Sheet alongside other apps.

---

## Features

| Feature | Mobile | Desktop |
|---------|--------|---------|
| Browse events (search, filter) | ✅ | ✅ |
| Event detail view | ✅ | ✅ |
| Research sessions | ✅ | ✅ |
| Clipboard URL capture | ✅ (mobile only) | ❌ |
| Upload URL | ✅ | ✅ |
| Camera document scan | ✅ (mobile only) | ❌ |
| Upload photos/PDFs | ✅ | ✅ |
| AI analysis | ✅ | ✅ |
| Notifications | ✅ | ✅ |
| My Uploads | ✅ | ✅ |
| Face ID / Touch ID login | ✅ (mobile only) | ❌ |
| Chat | 🔜 | ✅ |
| Network graph | ❌* | ✅ |
| Presentations editor | ❌* | ✅ |
| Spreadsheet view | ❌* | ✅ |
| Full admin panel | ❌* | ✅ |

*Desktop-exclusive for now. Network graph requires vis-network (web-only library). Presentations editor needs drag-and-drop which is complex on touch. These may be added in future updates.

---

## Tech Stack

- **Expo SDK 52** + **Expo Router 4** — navigation and native APIs
- **React Native 0.76** — cross-platform UI
- **TypeScript** — type safety
- **Supabase JS v2** — same database as web app
- **expo-clipboard** — clipboard monitoring for research session
- **expo-camera** — document scanning
- **expo-image-picker** — photo library access
- **expo-local-authentication** — Face ID / Touch ID
- **expo-linking** — deep links for share extension

---

## Project Structure

```
mobile-app/
├── app/                    # Expo Router screens
│   ├── _layout.tsx         # Root layout (auth gate)
│   ├── login.tsx           # Login screen
│   ├── (tabs)/             # Main bottom tab bar
│   │   ├── index.tsx       # Dashboard / Home
│   │   ├── events.tsx      # Browse all events
│   │   ├── research.tsx    # Research session hub
│   │   ├── upload.tsx      # Upload sources
│   │   └── account.tsx     # Profile + settings
│   └── (modals)/           # Full-screen modals
│       ├── event-detail.tsx  # Event detail view
│       └── session-detail.tsx # Research session detail
└── src/
    ├── config.ts            # Supabase + API URLs
    ├── types/               # TypeScript interfaces
    ├── theme/               # Colors, typography, spacing
    ├── services/            # Supabase client, backend API
    ├── contexts/            # Auth state, Research session state
    ├── hooks/               # Clipboard monitor, events loader
    └── components/          # EventCard, FilterSheet, etc.
```

---

## Troubleshooting

**"Metro bundler fails to start"**
```bash
npx expo start --clear
```

**"Dependency errors on install"**
```bash
rm -rf node_modules package-lock.json
npm install
```

**"Events not loading"**
- Check your internet connection
- The Supabase database is shared with the web app — if the web app loads events, the mobile app should too

**"Analysis server is slow"**
- The backend on Render (free tier) sleeps after 15 min of no use
- First request takes ~30 seconds to wake it up
- Subsequent requests are fast

**"Biometric login says 'no saved session'"**
- Log in once with your password first — biometric login re-uses the saved session

---

## Environment / Config

All configuration lives in `src/config.ts`. The Supabase URL, anon key, and backend API URL are the same values used by the web app (historical-events-v2.2.html).

No `.env` file is needed — these are safe to include in source for this project since the anon key is public-facing by design.
