// FILE: netlify/functions/getDoctorDetails.ts
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Database configuration error." }) };
    }
    try {
        const { specialty, doctorName } = JSON.parse(event.body || '{}');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        
        let query = supabase.from('doctors').select('name, specialty');

        if (specialty) {
            query = query.ilike('specialty', `%${specialty}%`);
        }

        // --- CHANGE IS HERE ---
        // This new logic is much more flexible for searching names.
        // It takes an input like "kss aditya" and searches for records containing BOTH "kss" AND "aditya".
        if (doctorName) {
            const searchTerms = doctorName.trim().split(/\s+/).join(' & ');
            query = query.textSearch('name', searchTerms, {
                type: 'websearch', // This is a flexible search type
                config: 'english'
            });
        }
        // --- END OF CHANGE ---

        const { data, error } = await query;
        if (error) throw error;
        
        return { statusCode: 200, headers, body: JSON.stringify({ doctors: data }) };

    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };

