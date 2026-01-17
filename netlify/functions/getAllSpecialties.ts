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
        const { data, error } = await supabase
            .from('doctors')
            .select('specialty');

        if (error) throw error;

        // Get unique specialties
        const specialties = [...new Set(data.map(item => item.specialty))];

        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ success: true, specialties }) 
        };
    } catch (error: any) {
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ success: false, message: error.message }) 
        };
    }
};