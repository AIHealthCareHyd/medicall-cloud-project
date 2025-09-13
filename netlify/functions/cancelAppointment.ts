// FILE: netlify/functions/cancelAppointment.ts
// FIXED VERSION: More robust cancellation with flexible doctor name matching

import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- cancelAppointment function started ---");
    console.log("Request body:", event.body);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Database configuration error." }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        console.error("JSON parse error:", e);
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }

    const { patientName, doctorName, date, time } = body;
    console.log(`Attempting to cancel for ${patientName} with ${doctorName} on ${date} at ${time || 'any time'}`);

    if (!patientName || !doctorName || !date) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Missing required details to find the appointment." }) };
    }

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        // Step 1: Find the doctor's unique ID using flexible name matching (like booking does)
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .ilike('name', `%${doctorName}%`) // Changed from .eq to .ilike for flexible matching
            .single();

        if (doctorError || !doctorData) {
            console.error("Could not find doctor:", doctorName, doctorError);
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }
       
        const doctorId = doctorData.id;
        console.log(`Found doctor ID: ${doctorId} for name: ${doctorName}`);

        // Step 2: Build the match criteria - include time if provided
        const matchCriteria: any = {
            patient_name: patientName,
            doctor_id: doctorId,
            appointment_date: date,
            status: 'confirmed'
        };

        // Only include time in match if it was provided
        if (time) {
            matchCriteria.appointment_time = time;
        }

        console.log("Match criteria:", matchCriteria);

        // Step 3: Delete the appointment that matches the criteria
        const { data: deletedData, error: deleteError } = await supabase
            .from('appointments')
            .delete()
            .match(matchCriteria)
            .select(); // Ask Supabase to return the record(s) that were deleted

        if (deleteError) {
            console.error("Error during delete operation:", deleteError);
            throw deleteError;
        }

        // Step 4: Check if anything was actually deleted
        if (!deletedData || deletedData.length === 0) {
            console.log("No matching appointment found to cancel.");
            
            // Try to find if there's any appointment for debugging
            const { data: debugData } = await supabase
                .from('appointments')
                .select('*')
                .eq('patient_name', patientName)
                .eq('doctor_id', doctorId)
                .eq('appointment_date', date);
            
            console.log("Debug - Found appointments for this patient/doctor/date:", debugData);
            
            return { 
                statusCode: 404, 
                headers, 
                body: JSON.stringify({ 
                    success: false, 
                    message: `Could not find a confirmed appointment for ${patientName} with ${doctorName} on ${date}${time ? ` at ${time}` : ''}.` 
                }) 
            };
        }

        // If we get here, the deletion was successful
        console.log("Successfully cancelled appointment:", deletedData);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'The appointment has been successfully cancelled.' })
        };

    } catch (error: any) {
        console.error("FATAL: Error during Supabase operation.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message || 'An unexpected error occurred.' }) };
    }
};

export { handler };