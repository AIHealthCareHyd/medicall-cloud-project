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

        const { data: doctorData, error: doctorError } = await supabase.from('doctors').select('id').ilike('name', `%${doctorName}%`).single();
        if (doctorError || !doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }

        // Instead of deleting, we update the status to 'cancelled'. This preserves the record.
        const { error } = await supabase
            .from('appointments')
            .update({ status: 'cancelled' })
            .eq('doctor_id', doctorData.id)
            .ilike('patient_name', `%${patientName}%`) // Use ilike for flexible name matching
            .eq('appointment_date', date);

        if (error) throw error;

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Appointment successfully cancelled.' }) };

    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };