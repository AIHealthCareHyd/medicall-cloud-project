// FILE: netlify/functions/getDoctorDetails.ts
// This version wraps the response in an object to satisfy the Gemini API.

// This line imports the necessary tool to connect to our Supabase database.
// Think of it as grabbing the specific phone needed to call the database.
import { createClient } from '@supabase/supabase-js';

// This line imports the standard "rulebook" for how a Netlify serverless function should behave.
import type { Handler } from '@netlify/functions';

// A serverless function is a small, independent piece of code that runs on demand.
// This 'handler' is the main entry point for our function. It's what runs when the function is called.
const handler: Handler = async (event) => {
    // A log message to let us know that the function has started. Useful for debugging.
    console.log("--- getDoctorDetails function started ---");

    // This is a crucial security and configuration check.
    // It makes sure we have the address (URL) and the password (ANON_KEY) to access our database.
    // If these are missing, we can't proceed, so we stop and report a major error.
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        console.error("FATAL: Supabase environment variables are not set.");
        // Returns a "500 Internal Server Error" message, indicating a problem on our end.
        return { statusCode: 500, body: JSON.stringify({ error: "Database configuration error." }) };
    }
    console.log("Step 1: Supabase environment variables found.");

    // Here, we create the actual connection to our database using the address and password.
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    
    // This variable will hold the instructions we receive from the user's request.
    let body;
    try {
        // The instructions (like "find me a cardiologist") arrive in a digital package (JSON).
        // This line opens that package and reads the contents.
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        // If the package is damaged or unreadable, we report an error.
        console.error("FATAL: Could not parse request body.", e);
        // Returns a "400 Bad Request" message, meaning the user sent something we couldn't understand.
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
    }
    console.log("Step 2: Successfully parsed request body.");

    // We pull out the specific 'specialty' the user is asking for from the instructions.
    const { specialty } = body;
    console.log(`Step 3: Searching for specialty: "${specialty || 'any'}"`);

    try {
        // This is where we talk to the database. We start by saying:
        // "From the 'doctors' table, I want to select the 'name' and 'specialty' of the doctors."
        let query = supabase.from('doctors').select('name, specialty');
        
        // This is a conditional filter. If the user provided a specialty...
        if (specialty) {
            // ...we add to our request: "Only show me doctors whose specialty is similar to what I'm looking for."
            // 'ilike' means the search is case-insensitive and flexible (e.g., 'cardio' finds 'Cardiology').
            query = query.ilike('specialty', `%${specialty}%`);
        }
        
        // We send our completed query to the database and wait for the results.
        const { data, error } = await query;

        // If the database responds with an error, we immediately stop and handle it.
        if (error) {
            throw error; // This jumps to the 'catch' block below.
        }

        // We log how many doctors we found.
        console.log(`Step 4: Found ${data?.length || 0} doctors.`);
        
        // --- THIS IS THE FIX ---
        // We package the results neatly. Instead of just sending a list of doctors,
        // we put the list inside a container labeled 'doctors'. This is like putting letters in a labeled envelope.
        const responsePayload = { doctors: data || [] };
        
        // We send back a "200 OK" status, meaning everything worked, along with the list of doctors.
        return { statusCode: 200, body: JSON.stringify(responsePayload) };

    } catch (error) {
        // If anything went wrong during the database query, this block catches the error.
        console.error("FATAL: Error during Supabase query.", error);
        // We send a "500 Internal Server Error" and a message explaining the problem.
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

// This line makes our 'handler' function available to be used by Netlify.
export { handler };
