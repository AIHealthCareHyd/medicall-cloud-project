// FILE: netlify/functions/bookAppointment.ts
// This function adds a new appointment to the Supabase database.

import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- bookAppointment function started ---");

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Database configuration error." }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }

    const { doctorName, patientName, date, time } = body;
    console.log(`Attempting to book for ${patientName} with ${doctorName} on ${date} at ${time}`);

    if (!doctorName || !patientName || !date || !time) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required appointment details." }) };
    }

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        // First, find the ID of the doctor based on their name
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .eq('name', doctorName)
            .single();

        if (doctorError || !doctorData) {
            console.error("Could not find doctor:", doctorName, doctorError);
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }

        const doctorId = doctorData.id;

        // Now, insert the new appointment into the database
        const { error: appointmentError } = await supabase
            .from('appointments')
            .insert({
                patient_name: patientName,
                doctor_id: doctorId,
                appointment_date: date,
                appointment_time: time,
            });

        if (appointmentError) {
            throw appointmentError;
        }

        console.log("Successfully booked appointment.");
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'Appointment booked successfully.' })
        };

    } catch (error) {
        console.error("FATAL: Error during Supabase insert operation.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };
