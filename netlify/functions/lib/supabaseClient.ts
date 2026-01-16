// netlify/functions/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
// Use SERVICE_ROLE_KEY for backend functions to bypass RLS safely
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; 

export const supabase = createClient(supabaseUrl, supabaseKey);