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

        // --- CHANGE IS HERE: Upgraded the specialty search to be more flexible ---
        // This will now correctly match a symptom like "broken bone" (which the AI will interpret as 'orthopedics')
        // to the "Orthopaedics" specialty in your Supabase table.
        if (specialty) {
            const searchTerms = specialty.trim().split(/\s+/).join(' | '); // Use OR for specialty words
            query = query.textSearch('specialty', searchTerms, {
                type: 'websearch',
                config: 'english'
            });
        }
        // --- END OF CHANGE ---

        if (doctorName) {
            const searchTerms = doctorName.trim().split(/\s+/).join(' & '); // Use AND for doctor names
            query = query.textSearch('name', searchTerms, {
                type: 'websearch',
                config: 'english'
            });
        }

        const { data, error } = await query;
        if (error) throw error;
        
        return { statusCode: 200, headers, body: JSON.stringify({ doctors: data }) };

    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };

