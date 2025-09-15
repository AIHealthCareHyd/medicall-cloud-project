// FILE: netlify/functions/getAvailableSlots.ts
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Database configuration error." }) };
    }
    try {
        const { doctorName, date } = JSON.parse(event.body || '{}');
        if (!doctorName || !date) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Doctor name and date are required." }) };
        }

        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        const { data: doctorData, error: doctorError } = await supabase.from('doctors').select('id').ilike('name', `%${doctorName}%`).single();
        if (doctorError || !doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }

        // Fetch all confirmed appointments for this doctor on the given date
        const { data: bookedAppointments, error: bookedError } = await supabase
            .from('appointments')
            .select('appointment_time')
            .eq('doctor_id', doctorData.id)
            .eq('appointment_date', date)
            .eq('status', 'confirmed');

        if (bookedError) throw bookedError;

        // --- DYNAMIC LOGIC STARTS HERE ---
        // 1. Define doctor's working hours and slot duration
        const dayStart = new Date(`${date}T09:00:00`);
        const dayEnd = new Date(`${date}T17:00:00`);
        const slotDurationMinutes = 15; // Your 15-minute requirement

        // 2. Create a fast way to check if a slot is booked
        const bookedTimes = new Set(bookedAppointments.map(appt => appt.appointment_time));
        
        // 3. Loop through the day and generate available slots
        const availableSlots = [];
        let currentTime = dayStart;

        while (currentTime < dayEnd) {
            // Exclude common lunch break (1:00 PM to 2:00 PM)
            if (currentTime.getHours() !== 13) {
                 const timeString = currentTime.toLocaleTimeString('en-GB'); // Format as "HH:mm:ss"

                // If the current time slot is NOT in the set of booked times, it's available
                if (!bookedTimes.has(timeString)) {
                    availableSlots.push(currentTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }));
                }
            }
            // Move to the next 15-minute slot for the next loop iteration
            currentTime.setMinutes(currentTime.getMinutes() + slotDurationMinutes);
        }
        // --- DYNAMIC LOGIC ENDS HERE ---

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, availableSlots }) };

    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };