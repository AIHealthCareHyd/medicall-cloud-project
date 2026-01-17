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
        const { doctorName, specialty } = JSON.parse(event.body || '{}');

        let query = supabase.from('doctors').select('name, specialty, available_slots');

        if (doctorName) query = query.ilike('name', `%${doctorName}%`);
        if (specialty) query = query.ilike('specialty', `%${specialty}%`);

        const { data, error } = await query;
        if (error) throw error;

        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ success: true, doctors: data }) 
        };
    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};