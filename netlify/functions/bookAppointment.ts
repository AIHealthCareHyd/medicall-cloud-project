// FILE: netlify/functions/bookAppointment.ts
// This version now accepts and saves the patient's phone number.

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

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }

    // --- UPDATED: Destructure the new 'phone' field ---
    const { doctorName, patientName, phone, date, time } = body;

    // --- UPDATED: Add 'phone' to the validation check ---
    if (!doctorName || !patientName || !phone || !date || !time) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required appointment details, including phone number." }) };
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

        // --- UPDATED: Add the 'phone' field to the data being inserted ---
        const { error: appointmentError } = await supabase
            .from('appointments')
            .insert({
                patient_name: patientName,
                doctor_id: doctorId,
                phone: phone, // Save the phone number
                appointment_date: date,
                appointment_time: time,
            });

        if (appointmentError) {
            throw appointmentError;
        }

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
