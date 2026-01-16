// FILE: netlify/functions/cancelAppointment.ts
import { supabase } from './lib/supabaseClient';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    // 1. Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    try {
        // 2. Parse and Validate Request
        const { doctorName, patientName, date } = JSON.parse(event.body || '{}');
        
        if (!doctorName || !patientName || !date) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ error: "Missing details required for cancellation." }) 
            };
        }

        // 3. Find Doctor ID (Using centralized 'supabase' client)
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .ilike('name', `%${doctorName}%`)
            .single();

        if (doctorError || !doctorData) {
            return { 
                statusCode: 404, 
                headers, 
                body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) 
            };
        }

        // 4. Update Appointment Status
        // Soft-cancel by changing status to 'cancelled' to keep the audit trail.
        const { data: updatedData, error } = await supabase
            .from('appointments')
            .update({ status: 'cancelled' })
            .eq('doctor_id', doctorData.id)
            .ilike('patient_name', `%${patientName}%`)
            .eq('appointment_date', date)
            .eq('status', 'confirmed') // Only cancel confirmed appointments
            .select();

        if (error) throw error;

        // 5. Check if an actual row was updated
        if (!updatedData || updatedData.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: `No confirmed appointment found for ${patientName} on ${date} with ${doctorName}.` 
                })
            };
        }

        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ success: true, message: 'Appointment successfully cancelled.' }) 
        };

    } catch (error: any) {
        console.error("Cancellation Error:", error.message);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ success: false, message: error.message }) 
        };
    }
};

export { handler };