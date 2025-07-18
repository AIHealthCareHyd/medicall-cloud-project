// FILE: netlify/functions/getDoctorDetails.ts
// This version wraps the response in an object to satisfy the Gemini API.

import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';

const handler: Handler = async (event) => {
    console.log("--- getDoctorDetails function started ---");

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        console.error("FATAL: Supabase environment variables are not set.");
        return { statusCode: 500, body: JSON.stringify({ error: "Database configuration error." }) };
    }
    console.log("Step 1: Supabase environment variables found.");

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    
    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        console.error("FATAL: Could not parse request body.", e);
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
    }
    console.log("Step 2: Successfully parsed request body.");

    const { specialty } = body;
    console.log(`Step 3: Searching for specialty: "${specialty || 'any'}"`);

    try {
        let query = supabase.from('doctors').select('name, specialty');
        if (specialty) {
            query = query.ilike('specialty', `%${specialty}%`);
        }
        
        const { data, error } = await query;

        if (error) {
            throw error; // Let the catch block handle it
        }

        console.log(`Step 4: Found ${data?.length || 0} doctors.`);
        
        // --- THIS IS THE FIX ---
        // We now return an object with a 'doctors' key, not just the array.
        const responsePayload = { doctors: data || [] };
        
        return { statusCode: 200, body: JSON.stringify(responsePayload) };

    } catch (error) {
        console.error("FATAL: Error during Supabase query.", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export { handler };
