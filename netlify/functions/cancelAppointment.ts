// FILE: netlify/functions/cancelAppointment.ts
// This version updates the appointment status to 'cancelled' instead of deleting it.

import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
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

    if (!patientName || !doctorName || !date) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Missing required details to find the appointment." }) };
    }

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .ilike('name', `%${doctorName}%`)
            .single();

        if (doctorError || !doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }
        
        const doctorId = doctorData.id;

        // Find the appointment and update its status to 'cancelled'
        const { data: updatedData, error: updateError } = await supabase
            .from('appointments')
            .update({ status: 'cancelled' }) // Change status instead of deleting
            .match({ 
                patient_name: patientName,
                doctor_id: doctorId,
                appointment_date: date,
                status: 'confirmed' // Only cancel appointments that are currently confirmed
            })
            .select();

        if (updateError) {
            throw updateError;
        }

        if (!updatedData || updatedData.length === 0) {
            return { 
                statusCode: 404, 
                headers, 
                body: JSON.stringify({ 
                    success: false, 
                    message: `Could not find a confirmed appointment for ${patientName} with ${doctorName} on ${date} to cancel.` 
                }) 
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'The appointment has been successfully cancelled.' })
        };

    } catch (error: any) {
        console.error("FATAL: Error during Supabase operation.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message || 'An unexpected error occurred.' }) };
    }
};

export { handler };