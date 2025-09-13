// FILE: netlify/functions/bookAppointment.ts
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
        const { doctorName, patientName, date, time, phone } = JSON.parse(event.body || '{}');
        if (!doctorName || !patientName || !date || !time || !phone) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required appointment details." }) };
        }
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        const { data: doctorData, error: doctorError } = await supabase.from('doctors').select('id').ilike('name', `%${doctorName}%`).single();
        if (doctorError || !doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }
        const { error: appointmentError } = await supabase.from('appointments').insert({ patient_name: patientName, doctor_id: doctorData.id, appointment_date: date, appointment_time: time, phone: phone });
        if (appointmentError) throw appointmentError;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Appointment booked successfully.' }) };
    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };
