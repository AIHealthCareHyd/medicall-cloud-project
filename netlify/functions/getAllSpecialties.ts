// FILE: netlify/functions/getAllSpecialties.ts
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
        // 2. Fetch all specialties (Using centralized 'supabase' client)
        // We select only the 'specialty' column to keep the data transfer light
        const { data, error } = await supabase
            .from('doctors')
            .select('specialty');

        if (error) throw error;

        // 3. Extract unique values
        // This ensures the AI doesn't see "Radiology" listed multiple times
        const uniqueSpecialties = [...new Set(data.map(doctor => doctor.specialty))];

        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ specialties: uniqueSpecialties }) 
        };

    } catch (error: any) {
        console.error("Error in getAllSpecialties:", error.message);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ success: false, message: error.message }) 
        };
    }
};

export { handler };