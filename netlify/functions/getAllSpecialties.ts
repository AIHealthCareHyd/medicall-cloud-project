// FILE: netlify/functions/getAllSpecialties.ts
// This function connects to the database and returns a unique list of all doctor specialties.

// Import the tool to connect to our Supabase database.
import { createClient } from '@supabase/supabase-js';
// Import the standard rulebooks for Netlify functions.
import type { Handler, HandlerEvent } from '@netlify/functions';

// Standard headers to allow our website to access this function (CORS).
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// We get the database address and password from our environment settings.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
// If they are missing, we can't do anything, so we stop the whole system with an error.
if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL or Key is not set in environment variables.");
}
// We create the connection to the database immediately.
const supabase = createClient(supabaseUrl, supabaseKey);


// This is the main handler for the function.
const handler: Handler = async (event: HandlerEvent) => {
    // A standard preflight check for CORS. The browser asks for permission, we say "yes".
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    try {
        // This is the core database query. It's very simple:
        // "From the 'doctors' table, select ONLY the 'specialty' column for every single record."
        const { data, error } = await supabase
            .from('doctors')
            .select('specialty');

        // If the database gave us an error, we handle it immediately.
        if (error) {
            console.error("Supabase query error:", error);
            throw new Error(error.message); // This jumps to the 'catch' block below.
        }

        // This is a clever JavaScript trick to remove duplicates.
        // 1. `data.map(doctor => doctor.specialty)` creates a simple list of all specialties, e.g., ['Cardiology', 'Radiology', 'Cardiology'].
        // 2. `new Set(...)` takes that list and automatically removes any duplicates, resulting in {'Cardiology', 'Radiology'}.
        // 3. `[... ]` converts this Set back into a normal list.
        const uniqueSpecialties = [...new Set(data.map(doctor => doctor.specialty))];

        // We return a "200 OK" status and the clean list of unique specialties.
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ specialties: uniqueSpecialties }),
        };

    } catch (error) {
        // This is our safety net. If anything went wrong above, we land here.
        console.error("Error in getAllSpecialties function:", error);
        // We return a "500 Internal Server Error" to indicate a problem on our end.
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to fetch specialties.' }),
        };
    }
};

// Make the function available for Netlify to use.
export { handler };
