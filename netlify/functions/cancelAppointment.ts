// Import the tool needed to connect to our Supabase database.
import { createClient } from '@supabase/supabase-js';
// Import the standard rulebooks for Netlify functions.
import type { Handler, HandlerEvent } from '@netlify/functions';

// Standard headers to allow our website to access this function (CORS).
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// This is the main function that runs when a cancellation request is received.
const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- cancelAppointment function started ---");

    // Standard preflight check for CORS.
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    // Security check for database credentials.
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Database configuration error." }) };
    }

    // This will hold the details of the appointment to cancel.
    let body;
    try {
        // We parse the incoming request to get the cancellation details.
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }

    // We unpack the necessary details: patient name, doctor name, and date.
    const { patientName, doctorName, date } = body;
    console.log(`Attempting to cancel for ${patientName} with ${doctorName} on ${date}`);

    // Validation: If any of these details are missing, we can't find the appointment.
    if (!patientName || !doctorName || !date) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required details to find the appointment." }) };
    }

    try {
        // We establish a connection to our database.
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        // Step 1: Find the doctor's unique ID using their name. The database needs the ID, not the name.
        // We ask the database: "From the 'doctors' table, get the 'id' where the 'name' is an exact match."
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .eq('name', doctorName) // 'eq' means exact match.
            .single();

        // If we can't find the doctor, we stop and report the issue.
        if (doctorError || !doctorData) {
            console.error("Could not find doctor:", doctorName, doctorError);
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }
        // We store the doctor's ID.
        const doctorId = doctorData.id;

        // Step 2: Find the specific appointment and update its status.
        // This is the core logic. We tell the database: "In the 'appointments' table, update the record..."
        const { data: updatedAppointment, error: updateError } = await supabase
            .from('appointments')
            .update({ status: 'cancelled' }) // "...by changing its 'status' field to 'cancelled'..."
            .match({ // "...but ONLY IF it matches all of these conditions:"
                patient_name: patientName,
                doctor_id: doctorId,
                appointment_date: date,
                status: 'confirmed' // Crucially, we only cancel appointments that are currently 'confirmed'.
            })
            .select(); // '.select()' asks the database to return the record that was just updated.

        // If there was an error during the update process, we throw it to the catch block.
        if (updateError) {
            throw updateError;
        }

        // If 'updatedAppointment' is empty, it means no record matched all our conditions.
        // This tells us that a confirmed appointment for that person on that day was not found.
        if (!updatedAppointment || updatedAppointment.length === 0) {
             return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a confirmed appointment for ${patientName} with ${doctorName} on ${date}.` }) };
        }

        // If we get here, the cancellation was successful.
        console.log("Successfully cancelled appointment.");
        // We return a "200 OK" status and a confirmation message.
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'The appointment has been successfully cancelled.' })
        };

    } catch (error) {
        // This is the safety net for any errors during the database operation.
        console.error("FATAL: Error during Supabase update operation.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

// Make the function available for Netlify to use.
export { handler };
