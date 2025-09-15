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
    // ... (keep database connection and initial error checks the same)
    try {
        // --- CHANGE IS HERE: Now expecting an optional 'timeOfDay' ---
        const { doctorName, date, timeOfDay } = JSON.parse(event.body || '{}');
        if (!doctorName || !date) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Doctor name and date are required." }) };
        }

        const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
        // ... (keep doctor lookup and bookedAppointments query the same)
        const { data: doctorData, ... } = await supabase.from('doctors')...
        const { data: bookedAppointments, ... } = await supabase.from('appointments')...

        // --- DYNAMIC LOGIC AND GROUPING (Same as before) ---
        const dayStart = new Date(`${date}T09:00:00`);
        const dayEnd = new Date(`${date}T17:00:00`);
        const slotDurationMinutes = 15;
        const bookedTimes = new Set(bookedAppointments.map(appt => appt.appointment_time));
        
        const morningSlots = [], afternoonSlots = [], eveningSlots = [];
        let currentTime = dayStart;
        while (currentTime < dayEnd) {
           // ... (the slot calculation and grouping logic is the same as your current code)
        }

        const groupedSlots = {
            morning: morningSlots,
            afternoon: afternoonSlots,
            evening: eveningSlots
        };

        // --- CHANGE IS HERE: Return different data based on the request ---

        // If a specific time of day was requested, return the slots for it.
        if (timeOfDay && groupedSlots[timeOfDay]) {
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ success: true, availableSlots: groupedSlots[timeOfDay] }) 
            };
        }

        // Otherwise, this is the first call. Return the names of periods that have slots.
        const availablePeriods = [];
        if (groupedSlots.morning.length > 0) availablePeriods.push('morning');
        if (groupedSlots.afternoon.length > 0) availablePeriods.push('afternoon');
        if (groupedSlots.evening.length > 0) availablePeriods.push('evening');
        
        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ success: true, availablePeriods }) 
        };

    } catch (error: any) {
        // ... (keep catch block the same)
    }
};

export { handler };