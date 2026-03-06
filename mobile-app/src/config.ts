// HistoDB Mobile App — Configuration
// Connects to the same Supabase database and backend as the web app

export const SUPABASE_URL = 'https://dfkxdbkjrfarjudlpqbw.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRma3hkYmtqcmZhcmp1ZGxwcWJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDQzMzIsImV4cCI6MjA4NzUyMDMzMn0.A5XuY5C9X5Il6EizS84tKY1Ls3Jyl6Xmi0hKbqQg2qo';

// Python backend on Render (free tier — may take ~30s to wake up)
export const API_BASE_URL = 'https://historical-events-api-n45u.onrender.com';

// AsyncStorage keys
export const STORAGE_KEYS = {
  SESSION: 'hdb_session',
  ACTIVE_RESEARCH_SESSION: 'hdb_active_research_session',
  BIOMETRICS_ENABLED: 'hdb_biometrics_enabled',
  LAST_CLIPBOARD: 'hdb_last_clipboard',
};

// App URL scheme (for deep links and iOS Share Extension)
export const APP_SCHEME = 'histodb';
