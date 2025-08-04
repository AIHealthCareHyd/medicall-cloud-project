// FILE: netlify/functions/rescheduleAppointment.ts
// This function finds an appointment and updates its date and time.

import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- rescheduleAppointment function started ---");

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

    const { patientName, doctorName, oldDate, newDate, newTime } = body;

    if (!patientName || !doctorName || !oldDate || !newDate || !newTime) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required details for rescheduling." }) };
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
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }
        const doctorId = doctorData.id;

        // Now, find the original appointment and update its date and time
        const { data: updatedAppointment, error: updateError } = await supabase
            .from('appointments')
            .update({ 
                appointment_date: newDate,
                appointment_time: newTime 
            })
            .match({ 
                patient_name: patientName,
                doctor_id: doctorId,
                appointment_date: oldDate,
                status: 'confirmed'
            })
            .select();

        if (updateError) {
            throw updateError;
        }

        if (!updatedAppointment || updatedAppointment.length === 0) {
             return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a confirmed appointment for ${patientName} with ${doctorName} on ${oldDate}.` }) };
        }

        console.log("Successfully rescheduled appointment.");
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: `The appointment has been successfully rescheduled to ${newDate} at ${newTime}.` })
        };

    } catch (error) {
        console.error("FATAL: Error during Supabase update operation.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };
