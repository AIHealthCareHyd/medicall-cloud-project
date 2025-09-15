// FILE: netlify/functions/getDoctorDetails.ts
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Database configuration error." }) };
    }
    try {
        const { specialty, doctorName } = JSON.parse(event.body || '{}');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        let query = supabase.from('doctors').select('name, specialty');
        if (specialty) query = query.ilike('specialty', `%${specialty}%`);
        if (doctorName) query = query.ilike('name', `%${doctorName}%`);
        const { data, error } = await query;
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ doctors: data }) };
    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };