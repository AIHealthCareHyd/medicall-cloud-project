// FILE: netlify/functions/getAllSpecialties.ts
// This function connects to the database and returns a unique list of all doctor specialties.

import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// Connect to Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL or Key is not set in environment variables.");
}
const supabase = createClient(supabaseUrl, supabaseKey);


const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    try {
        // Fetch all records from the doctors table
        const { data, error } = await supabase
            .from('doctors')
            .select('specialty');

        if (error) {
            console.error("Supabase query error:", error);
            throw new Error(error.message);
        }

        // Use a Set to get only the unique specialty names
        const uniqueSpecialties = [...new Set(data.map(doctor => doctor.specialty))];

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ specialties: uniqueSpecialties }),
        };

    } catch (error) {
        console.error("Error in getAllSpecialties function:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to fetch specialties.' }),
        };
    }
};

export { handler };
