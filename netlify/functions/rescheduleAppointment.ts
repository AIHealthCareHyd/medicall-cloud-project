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
        const { patientName, doctorName, oldDate, newDate, newTime } = JSON.parse(event.body || '{}');
        
        if (!patientName || !doctorName || !oldDate || !newDate || !newTime) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ success: false, message: "Missing required details for rescheduling." }) 
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
                body: JSON.stringify({ success: false, message: `Could not find doctor named ${doctorName}.` }) 
            };
        }

        // 5. Update the Appointment
        // We ensure we only update 'confirmed' appointments to prevent rescheduling cancelled ones
        const { data: updatedData, error: updateError } = await supabase
            .from('appointments')
            .update({ 
                appointment_date: newDate, 
                appointment_time: newTime 
            })
            .match({ 
                patient_name: patientName, 
                doctor_id: doctorData.id, 
                appointment_date: oldDate, 
                status: 'confirmed' 
            })
            .select();

        if (updateError) throw updateError;

        // 6. Verify if the update happened
        if (!updatedData || updatedData.length === 0) {
            return { 
                statusCode: 404, 
                headers, 
                body: JSON.stringify({ 
                    success: false, 
                    message: `Could not find a confirmed appointment for ${patientName} with ${doctorName} on ${oldDate}.` 
                }) 
            };
        }

        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ 
                success: true, 
                message: `The appointment has been successfully rescheduled to ${newDate} at ${newTime}.` 
            }) 
        };

    } catch (error: any) {
        console.error("Reschedule Tool Error:", error.message);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ success: false, message: error.message }) 
        };
    }
};