// FILE: netlify/functions/bookAppointment.ts
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
        const { doctorName, patientName, date, time, phone } = JSON.parse(event.body || '{}');
        
        if (!doctorName || !patientName || !date || !time || !phone) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ error: "Missing required appointment details." }) 
            };
        }

        // 3. Find Doctor ID (Using the centralized 'supabase' client)
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

        // 4. Safety Check: Is the slot already booked?
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
            return { 
                statusCode: 409, 
                headers, 
                body: JSON.stringify({ 
                    success: false, 
                    message: `Sorry, the time slot ${time} with ${doctorName} was just booked. Please try another time.` 
                }) 
            };
        }

        // 5. Insert Appointment
        const { error: appointmentError } = await supabase
            .from('appointments')
            .insert({ 
                patient_name: patientName, 
                doctor_id: doctorData.id, 
                appointment_date: date, 
                appointment_time: time, 
                phone: phone 
            });

        if (appointmentError) throw appointmentError;
        
        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ success: true, message: 'Appointment booked successfully.' }) 
        };

    } catch (error: any) {
        console.error("Booking Error:", error.message);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ success: false, message: error.message }) 
        };
    }
};

export { handler };