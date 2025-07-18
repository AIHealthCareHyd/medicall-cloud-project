import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';

// This is the main function that runs when the tool is called
const handler: Handler = async (event) => {
    // Exit early if the required environment variables are not set
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        console.error("Supabase environment variables are not set.");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Database configuration error." }),
        };
    }

    // Securely connect to your Supabase project
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    // Get the 'specialty' from the data sent by the AI
    const { specialty } = JSON.parse(event.body || '{}');

    // Start building a query to our 'doctors' table
    let query = supabase.from('doctors').select('name, specialty');

    // If the AI provided a specialty, filter the search
    if (specialty) {
        query = query.ilike('specialty', `%${specialty}%`);
    }

    // Execute the query
    const { data, error } = await query;

    // Handle any database errors
    if (error) {
        console.error("Database query error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    // If no doctors are found, send a helpful message
    if (!data || data.length === 0) {
        const message = specialty
            ? `I couldn't find any doctors with the specialty: ${specialty}.`
            : "I couldn't find any doctors in the system.";
        return { statusCode: 200, body: JSON.stringify({ message }) };
    }

    // If successful, send back the list of doctors found
    return {
        statusCode: 200,
        body: JSON.stringify(data),
    };
};

export { handler };