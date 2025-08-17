// FILE: netlify/functions/rescheduleAppointment.ts
// This function finds an appointment and updates its date and time.

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

// This is the main function that runs when a rescheduling request is received.
const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- rescheduleAppointment function started ---");

    // Standard preflight check for CORS.
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    // Security check for database credentials.
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Database configuration error." }) };
    }

    // This will hold the details for the rescheduling.
    let body;
    try {
        // We parse the incoming request to get the details.
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }

    // We unpack all the necessary details: patient, doctor, the OLD date, and the NEW date and time.
    const { patientName, doctorName, oldDate, newDate, newTime } = body;

    // Validation: If any piece of information is missing, we cannot proceed.
    if (!patientName || !doctorName || !oldDate || !newDate || !newTime) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required details for rescheduling." }) };
    }

    try {
        // We establish a connection to our database.
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        // Step 1: Find the doctor's unique ID from their name.
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .eq('name', doctorName)
            .single();

        // If the doctor isn't found, we stop and report the issue.
        if (doctorError || !doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }
        // We store the doctor's ID.
        const doctorId = doctorData.id;

        // Step 2: Find the original appointment and update its date and time.
        // This is the core logic. We tell the database: "In the 'appointments' table, update the record..."
        const { data: updatedAppointment, error: updateError } = await supabase
            .from('appointments')
            .update({ 
                appointment_date: newDate, // "...by setting the 'appointment_date' to the new date..."
                appointment_time: newTime  // "...and the 'appointment_time' to the new time..."
            })
            .match({ // "...but ONLY IF it matches all of these original conditions:"
                patient_name: patientName,
                doctor_id: doctorId,
                appointment_date: oldDate, // It must be on the specified OLD date.
                status: 'confirmed' // And it must be a 'confirmed' appointment.
            })
            .select(); // Ask the database to return the updated record.

        // If there was an error during the update, we throw it to the catch block.
        if (updateError) {
            throw updateError;
        }

        // If 'updatedAppointment' is empty, it means no appointment matched our original criteria.
        if (!updatedAppointment || updatedAppointment.length === 0) {
             return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a confirmed appointment for ${patientName} with ${doctorName} on ${oldDate}.` }) };
        }

        // If we reach this point, the reschedule was successful.
        console.log("Successfully rescheduled appointment.");
        // We return a "200 OK" status and a confirmation message with the new details.
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: `The appointment has been successfully rescheduled to ${newDate} at ${newTime}.` })
        };

    } catch (error) {
        // The safety net for any errors during the database operation.
        console.error("FATAL: Error during Supabase update operation.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

// Make the function available for Netlify to use.
export { handler };
