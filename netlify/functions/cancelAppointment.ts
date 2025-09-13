// FILE: netlify/functions/cancelAppointment.ts
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Database configuration error." }) };
    }
    try {
        const { patientName, doctorName, date } = JSON.parse(event.body || '{}');
        if (!patientName || !doctorName || !date) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Missing required details." }) };
        }
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        const { data: doctorData, error: doctorError } = await supabase.from('doctors').select('id').ilike('name', `%${doctorName}%`).single();
        if (doctorError || !doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find doctor named ${doctorName}.` }) };
        }
        const { data: updatedData, error: updateError } = await supabase.from('appointments').update({ status: 'cancelled' }).match({ patient_name: patientName, doctor_id: doctorData.id, appointment_date: date, status: 'confirmed' }).select();
        if (updateError) throw updateError;
        if (!updatedData || updatedData.length === 0) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a confirmed appointment for ${patientName} with ${doctorName} on ${date}.` }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'The appointment has been successfully cancelled.' }) };
    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };
