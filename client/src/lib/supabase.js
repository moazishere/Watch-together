import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

// Browser client: publishable (anon) key + the user's session. Everything it
// can read or write is limited by the Row Level Security policies in
// supabase/migrations/20260923000001_rls.sql.
export const supabase = supabaseConfigured ? createClient(url, key) : null;
