import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';

// Simple Supabase client — uses the same DB as the web app.
// We don't use Supabase Auth since the web app uses a custom users table.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Disable built-in auth session management since we manage sessions ourselves
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
