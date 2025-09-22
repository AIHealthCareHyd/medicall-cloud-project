// FILE: netlify/functions/getSupabaseConfig.ts
// This function's only purpose is to securely provide your Supabase keys
// from environment variables to your admin dashboard frontend.

import type { Handler } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*', // Allows your admin page to call this function
  'Content-Type': 'application/json'
};

export const handler: Handler = async () => {
    // This securely reads the keys from your Netlify environment variables
    // and sends them in a JSON response.
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            url: process.env.SUPABASE_URL,
            anonKey: process.env.SUPABASE_ANON_KEY
        })
    };
};
