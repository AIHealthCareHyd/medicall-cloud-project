// FILE: netlify/functions/rescheduleAppointment.ts
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
        const { patientName, doctorName, oldDate, newDate, newTime } = JSON.parse(event.body || '{}');
        
        if (!patientName || !doctorName || !oldDate || !newDate || !newTime) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ success: false, message: "Missing required details for rescheduling." }) 
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
                body: JSON.stringify({ success: false, message: `Could not find doctor named ${doctorName}.` }) 
            };
        }

        // 4. Update the Appointment
        // We use .match() to ensure we find the exact existing confirmed appointment
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

        // 5. Verify if the update happened
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
        console.error("Reschedule Error:", error.message);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ success: false, message: error.message }) 
        };
    }
};

export { handler };