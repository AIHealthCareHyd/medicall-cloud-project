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

    const { patientName, doctorName, date } = body;
    console.log(`Attempting to cancel for ${patientName} with ${doctorName} on ${date}`);

    if (!patientName || !doctorName || !date) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required details to find the appointment." }) };
    }

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        // First, find the doctor's ID
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

        // Now, find the appointment and update its status to 'cancelled'
        const { data: updatedAppointment, error: updateError } = await supabase
            .from('appointments')
            .update({ status: 'cancelled' })
            .match({ 
                patient_name: patientName,
                doctor_id: doctorId,
                appointment_date: date,
                status: 'confirmed' // Only cancel appointments that are currently confirmed
            })
            .select(); // Return the updated record

        if (updateError) {
            throw updateError;
        }

        if (!updatedAppointment || updatedAppointment.length === 0) {
             return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a confirmed appointment for ${patientName} with ${doctorName} on ${date}.` }) };
        }

        console.log("Successfully cancelled appointment.");
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'The appointment has been successfully cancelled.' })
        };

    } catch (error) {
        console.error("FATAL: Error during Supabase update operation.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };
