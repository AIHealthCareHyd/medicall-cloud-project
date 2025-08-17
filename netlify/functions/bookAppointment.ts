// FILE: netlify/functions/bookAppointment.ts
// This version uses a more flexible search to find the doctor.

// Import the tool needed to connect to our Supabase database.
import { createClient } from '@supabase/supabase-js';
// Import the standard "rulebooks" for how Netlify functions should work.
import type { Handler, HandlerEvent } from '@netlify/functions';

// These are standard "headers" we send with our response. They tell the web browser
// that it's okay for our website to talk to this function (this is a security feature called CORS).
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// This is the main function that runs when a booking request comes in.
const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- bookAppointment function started ---");

    // This is a standard check for CORS. Before sending the actual data, a browser might send
    // an 'OPTIONS' request to ask for permission. We just reply with "OK".
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    // Security check: Make sure we have the address and password for the database.
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Database configuration error." }) };
    }

    // This variable will hold the appointment details.
    let body;
    try {
        // We open the digital package (JSON) that contains the booking information.
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        // If the package is unreadable, we return an error.
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }

    // We unpack the specific details from the request: who the doctor is, the patient's name, and the date/time.
    const { doctorName, patientName, date, time } = body;
    console.log(`Attempting to book for ${patientName} with ${doctorName} on ${date} at ${time}`);

    // This is a validation step. If any of the required details are missing, we can't book the appointment.
    if (!doctorName || !patientName || !date || !time) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required appointment details." }) };
    }

    try {
        // We establish a connection to our database.
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        // --- THIS IS THE FIX ---
        // Before we can book, we need the doctor's unique ID, not just their name.
        // This step asks the database: "From the 'doctors' table, get the 'id' of a doctor whose name is like the one provided."
        // Using 'ilike' makes the search flexible (e.g., "Dr. Kumar" finds "Dr. Anil Kumar").
        // '.single()' tells the database we expect to find exactly one match.
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .ilike('name', `%${doctorName}%`)
            .single();

        // If we couldn't find the doctor, or if there was an error, we stop here.
        if (doctorError || !doctorData) {
            console.error("Could not find doctor:", doctorName, doctorError);
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }

        // We store the doctor's unique ID that we found.
        const doctorId = doctorData.id;

        // Now for the main event: we insert the new appointment into the database.
        // We tell the database: "In the 'appointments' table, add a new record with these details."
        const { error: appointmentError } = await supabase
            .from('appointments')
            .insert({
                patient_name: patientName,
                doctor_id: doctorId, // We use the ID we looked up.
                appointment_date: date,
                appointment_time: time,
            });

        // If there was an error during the insertion, we throw it to be handled by the 'catch' block.
        if (appointmentError) {
            throw appointmentError;
        }

        // If we reach this point, everything was successful!
        console.log("Successfully booked appointment.");
        // We send back a "200 OK" status and a success message.
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'Appointment booked successfully.' })
        };

    } catch (error) {
        // This is the safety net. If any part of our 'try' block failed, we end up here.
        console.error("FATAL: Error during Supabase insert operation.", error);
        // We return a "500 Internal Server Error" to indicate a problem on our side.
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

// Make the function available for Netlify to use.
export { handler };
