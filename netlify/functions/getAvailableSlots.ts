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

        // First, get the doctor's ID and their specific working hours from the database
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id, working_hours_start, working_hours_end')
            .ilike('name', `%${doctorName}%`)
            .single();

        if (doctorError || !doctorData) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) };
        }
        
        if (!doctorData.working_hours_start || !doctorData.working_hours_end) {
             return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Schedule not found for ${doctorName}. Please ensure working hours are set in the database.` }) };
        }

        // Dynamically generate all possible 30-minute slots based on the doctor's unique schedule
        const allPossibleSlots = [];
        const slotDuration = 30; // 30 minutes
        const [startHour, startMinute] = doctorData.working_hours_start.split(':').map(Number);
        const [endHour, endMinute] = doctorData.working_hours_end.split(':').map(Number);

        let currentHour = startHour;
        let currentMinute = startMinute;

        while (currentHour < endHour || (currentHour === endHour && currentMinute < endMinute)) {
            const hourString = String(currentHour).padStart(2, '0');
            const minuteString = String(currentMinute).padStart(2, '0');
            allPossibleSlots.push(`${hourString}:${minuteString}`);

            currentMinute += slotDuration;
            if (currentMinute >= 60) {
                currentHour++;
                currentMinute -= 60;
            }
        }

        // Find all confirmed appointments for this doctor on the given date
        const { data: bookedAppointments, error: bookedError } = await supabase
            .from('appointments')
            .select('appointment_time')
            .eq('doctor_id', doctorData.id)
            .eq('appointment_date', date)
            .eq('status', 'confirmed');

        if (bookedError) throw bookedError;

        const bookedTimes = bookedAppointments.map(appt => appt.appointment_time.substring(0, 5));
        
        // Filter the possible slots to find only the available ones
        const availableSlots = allPossibleSlots.filter(slot => !bookedTimes.includes(slot));

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, availableSlots }) };

    } catch (error: any) {
        console.error("Error in getAvailableSlots:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};

export { handler };

