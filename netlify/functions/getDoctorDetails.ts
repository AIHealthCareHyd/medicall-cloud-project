// FILE: netlify/functions/getDoctorDetails.ts
import { supabase } from './lib/supabaseClient';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    // 1. Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    try {
        // 2. Parse and Validate Request
        const { specialty, doctorName } = JSON.parse(event.body || '{}');
        
        // 3. Initialize Query (Using centralized 'supabase' client)
        let query = supabase.from('doctors').select('name, specialty');

        // 4. Flexible Specialty Search
        if (specialty) {
            const searchTerms = specialty.trim().split(/\s+/).join(' | '); // OR logic for keywords
            query = query.textSearch('specialty', searchTerms, {
                type: 'websearch',
                config: 'english'
            });
        }

        // 5. Flexible Doctor Name Search
        if (doctorName) {
            const searchTerms = doctorName.trim().split(/\s+/).join(' & '); // AND logic for name parts
            query = query.textSearch('name', searchTerms, {
                type: 'websearch',
                config: 'english'
            });
        }

        // 6. Execute Search
        const { data, error } = await query;
        
        if (error) throw error;
        
        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ doctors: data }) 
        };

    } catch (error: any) {
        console.error("Search Error in getDoctorDetails:", error.message);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ success: false, message: error.message }) 
        };
    }
};

export { handler };