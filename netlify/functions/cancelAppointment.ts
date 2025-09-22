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
        return { statusCode: 200, headers };
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Database configuration error." }) };
    }
    try {
        const { doctorName, patientName, date } = JSON.parse(event.body || '{}');
        if (!doctorName || !patientName || !date) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing details for cancellation." }) };
        }

        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        const { data: doctorData, error: doctorError } = await supabase.from('doctors').select('id').eq('name', doctorName).single();
        if (doctorError || !doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }

        // Find the appointment and update its status to 'cancelled'.
        const { data: updatedData, error: updateError } = await supabase
            .from('appointments')
            .update({ status: 'cancelled' })
            .match({ 
                doctor_id: doctorData.id,
                // --- CHANGE IS HERE: Use exact match for patient name for security ---
                patient_name: patientName,
                appointment_date: date,
                status: 'confirmed' // Only cancel appointments that are currently confirmed
            })
            .select(); // Use .select() to verify that a record was updated

        if (updateError) throw updateError;

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

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Appointment successfully cancelled.' }) };

    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };

