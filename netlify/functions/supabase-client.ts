// FILE: netlify/functions/lib/supabase-client.ts
// PURPOSE: Centralizes the Supabase client initialization for reuse across functions.

import { createClient } from '@supabase/supabase-js';

// Fetch the Supabase URL and anon key from your Netlify environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase URL and anon key are required.");
}

// Create and export the Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
