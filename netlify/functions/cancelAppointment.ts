// FILE: netlify/functions/cancelAppointment.ts
// FINAL VERSION: Deletes the appointment and accurately reports success or failure.

import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- cancelAppointment function started ---");

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
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

    const { patientName, doctorName, date } = body;
    console.log(`Attempting to cancel for ${patientName} with ${doctorName} on ${date}`);

    if (!patientName || !doctorName || !date) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Missing required details to find the appointment." }) };
    }

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        // Step 1: Find the doctor's unique ID using their name.
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

        // Step 2: Delete the appointment that matches all criteria.
        const { data: deletedData, error: deleteError } = await supabase
            .from('appointments')
            .delete()
            .match({
                patient_name: patientName,
                doctor_id: doctorId,
                appointment_date: date,
                status: 'confirmed'
            })
            .select(); // Ask Supabase to return the record(s) that were deleted.

        if (deleteError) {
            console.error("Error during delete operation:", deleteError);
            throw deleteError;
        }

        // Step 3: Check if anything was actually deleted.
        if (!deletedData || deletedData.length === 0) {
            // If the returned array is empty, it means no appointment matched the criteria.
            console.log("No matching appointment found to cancel.");
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a confirmed appointment for ${patientName} with ${doctorName} on ${date}.` }) };
        }

        // If we get here, the deletion was successful.
        console.log("Successfully cancelled appointment:", deletedData);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'The appointment has been successfully cancelled.' })
        };

    } catch (error) {
        console.error("FATAL: Error during Supabase operation.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };
