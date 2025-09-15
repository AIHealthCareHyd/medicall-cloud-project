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

        const { data: bookedAppointments, error: bookedError } = await supabase
            .from('appointments')
            .select('appointment_time')
            .eq('doctor_id', doctorData.id)
            .eq('appointment_date', date)
            .eq('status', 'confirmed');

        if (bookedError) throw bookedError;

        // --- DYNAMIC LOGIC AND GROUPING STARTS HERE ---
        const dayStart = new Date(`${date}T09:00:00`);
        const dayEnd = new Date(`${date}T17:00:00`);
        const slotDurationMinutes = 15;
        const bookedTimes = new Set(bookedAppointments.map(appt => appt.appointment_time));
        
        // 1. Create separate arrays for each part of the day
        const morningSlots = [];
        const afternoonSlots = [];
        const eveningSlots = [];
        
        let currentTime = dayStart;

        while (currentTime < dayEnd) {
            if (currentTime.getHours() !== 13) { // Exclude 1 PM lunch break
                const timeString = currentTime.toLocaleTimeString('en-GB');
                if (!bookedTimes.has(timeString)) {
                    const formattedTime = currentTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

                    // 2. Add the available slot to the correct group based on the hour
                    const hour = currentTime.getHours();
                    if (hour < 12) {
                        morningSlots.push(formattedTime);
                    } else if (hour >= 12 && hour < 16) { // 12 PM to 4 PM
                        afternoonSlots.push(formattedTime);
                    } else { // 4 PM onwards
                        eveningSlots.push(formattedTime);
                    }
                }
            }
            currentTime.setMinutes(currentTime.getMinutes() + slotDurationMinutes);
        }

        // 3. Combine the groups into a single object for the response
        const groupedSlots = {
            morning: morningSlots,
            afternoon: afternoonSlots,
            evening: eveningSlots
        };
        // --- DYNAMIC LOGIC AND GROUPING ENDS HERE ---

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, availableSlots: groupedSlots }) };

    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };