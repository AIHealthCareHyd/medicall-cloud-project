import { supabase } from './lib/supabaseClient';
import type { Handler, HandlerEvent } from '@netlify/functions';

// 1. The Permission Slip (CORS Headers)
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

export const handler: Handler = async (event: HandlerEvent) => {
    // 2. Handle the "Security Pre-Check" (OPTIONS)
    if (event.httpMethod === 'OPTIONS') {
        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ message: 'CORS preflight match successful' }) 
        };
    }

    try {
        // 3. Parse and Validate Request
        const { doctorName, patientName, date } = JSON.parse(event.body || '{}');
        
        if (!doctorName || !patientName || !date) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ success: false, error: "Missing details required for cancellation." }) 
            };
        }

        // 4. Find Doctor ID
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

        // 5. Update Appointment Status (Soft-cancel)
        const { data: updatedData, error } = await supabase
            .from('appointments')
            .update({ status: 'cancelled' })
            .eq('doctor_id', doctorData.id)
            .ilike('patient_name', `%${patientName}%`)
            .eq('appointment_date', date)
            .eq('status', 'confirmed') // Only cancel confirmed appointments
            .select();

        if (error) throw error;

        // 6. Check if an actual row was updated
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
        console.error("Cancellation Tool Error:", error.message);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ success: false, message: error.message }) 
        };
    }
};