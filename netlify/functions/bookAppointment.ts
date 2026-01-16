import { supabase } from './lib/supabaseClient';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS success' }) };
    }

    try {
        const { doctorName, patientName, date, time, phone } = JSON.parse(event.body || '{}');

        // 1. Find the Doctor ID
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .ilike('name', `%${doctorName}%`)
            .single();

        if (doctorError || !doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Doctor ${doctorName} not found.` }) };
        }

        // 2. Check if the slot is already taken (Double-booking prevention)
        const { data: existing } = await supabase
            .from('appointments')
            .select('id')
            .eq('doctor_id', doctorData.id)
            .eq('appointment_date', date)
            .eq('appointment_time', time)
            .eq('status', 'confirmed')
            .maybeSingle();

        if (existing) {
            return { statusCode: 409, headers, body: JSON.stringify({ success: false, message: 'This slot was just booked. Please pick another.' }) };
        }

        // 3. Insert the appointment
        const { error: insertError } = await supabase
            .from('appointments')
            .insert({
                patient_name: patientName,
                doctor_id: doctorData.id,
                appointment_date: date,
                appointment_time: time,
                phone: phone,
                status: 'confirmed'
            });

        if (insertError) throw insertError;

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Appointment booked successfully!' }) };

    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};