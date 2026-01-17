import { supabase } from './lib/supabaseClient';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS success' }) };
    }

    try {
        const { doctorName, date } = JSON.parse(event.body || '{}');

        // 1. Find Doctor
        const { data: doctorData } = await supabase
            .from('doctors')
            .select('id, available_slots')
            .ilike('name', `%${doctorName}%`)
            .single();

        if (!doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: "Doctor not found." }) };
        }

        // 2. Find Booked Slots
        const { data: booked } = await supabase
            .from('appointments')
            .select('appointment_time')
            .eq('doctor_id', doctorData.id)
            .eq('appointment_date', date)
            .eq('status', 'confirmed');

        const bookedTimes = booked?.map(b => b.appointment_time) || [];
        
        // 3. Filter available slots
        const available = doctorData.available_slots.filter((slot: string) => !bookedTimes.includes(slot));

        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ success: true, availableSlots: available }) 
        };
    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};