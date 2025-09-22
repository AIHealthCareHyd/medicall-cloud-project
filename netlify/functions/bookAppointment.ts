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

        // --- CHANGE IS HERE: Switched to an exact match for safety ---
        // This prevents booking for a partial or hallucinated name like "Dr. Srinivas".
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .eq('name', doctorName) // Use exact match '.eq()' instead of flexible '.ilike()'
            .single();
        // --- END OF CHANGE ---

        if (doctorError || !doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor with the exact name ${doctorName}.` }) };
        }

        const { data: existingAppointment, error: checkError } = await supabase
            .from('appointments')
            .select('id')
            .eq('doctor_id', doctorData.id)
            .eq('appointment_date', date)
            .eq('appointment_time', time)
            .eq('status', 'confirmed')
            .maybeSingle();

        if (checkError) throw checkError;

        if (existingAppointment) {
            return { statusCode: 409, headers, body: JSON.stringify({ success: false, message: `Sorry, the time slot ${time} with ${doctorName} was just booked by someone else. Please try another time.` }) };
        }
        
        const { error: appointmentError } = await supabase.from('appointments').insert({ patient_name: patientName, doctor_id: doctorData.id, appointment_date: date, appointment_time: time, phone: phone });
        if (appointmentError) throw appointmentError;
        
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Appointment booked successfully.' }) };
    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };

