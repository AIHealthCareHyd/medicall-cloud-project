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
        const { doctorName, date, timeOfDay } = JSON.parse(event.body || '{}');
        if (!doctorName || !date) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Doctor name and date are required." }) };
        }

        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        // --- CHANGE IS HERE: Switched from .ilike() to .eq() for an exact match ---
        // This prevents ambiguity and errors if two doctors have similar names.
        // The AI is expected to provide the full, exact name from the previous step.
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id, working_hours_start, working_hours_end')
            .eq('name', doctorName) // Use exact match '.eq()' for reliability
            .single();
        // --- END OF CHANGE ---

        if (doctorError || !doctorData) {
            // Updated error message for clarity
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Could not find a doctor with the exact name ${doctorName}.` }) };
        }
        
        if (!doctorData.working_hours_start || !doctorData.working_hours_end) {
             return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `Schedule not found for ${doctorName}.` }) };
        }

        const allPossibleSlots = [];
        const slotDuration = 30; // 30-minute slots
        const [startHour, startMinute] = doctorData.working_hours_start.split(':').map(Number);
        const [endHour, endMinute] = doctorData.working_hours_end.split(':').map(Number);
        let currentHour = startHour, currentMinute = startMinute;

        while (currentHour < endHour || (currentHour === endHour && currentMinute < endMinute)) {
            allPossibleSlots.push(`${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`);
            currentMinute += slotDuration;
            if (currentMinute >= 60) {
                currentHour++;
                currentMinute -= 60;
            }
        }

        const { data: bookedAppointments, error: bookedError } = await supabase
            .from('appointments')
            .select('appointment_time')
            .eq('doctor_id', doctorData.id)
            .eq('appointment_date', date)
            .eq('status', 'confirmed');

        if (bookedError) throw bookedError;
        
        const bookedTimes = bookedAppointments.map(appt => appt.appointment_time.substring(0, 5));
        const availableSlots = allPossibleSlots.filter(slot => !bookedTimes.includes(slot));

        const availableMorning = availableSlots.filter(slot => parseInt(slot.split(':')[0]) < 12);
        const availableAfternoon = availableSlots.filter(slot => parseInt(slot.split(':')[0]) >= 12 && parseInt(slot.split(':')[0]) < 17);
        const availableEvening = availableSlots.filter(slot => parseInt(slot.split(':')[0]) >= 17);

        // If 'timeOfDay' is not specified, return the general periods that have openings.
        if (!timeOfDay) {
            const availablePeriods = [];
            if (availableMorning.length > 0) availablePeriods.push('morning');
            if (availableAfternoon.length > 0) availablePeriods.push('afternoon');
            if (availableEvening.length > 0) availablePeriods.push('evening');
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, availablePeriods }) };
        }

        // If 'timeOfDay' is specified, return the specific slots for that period.
        switch (timeOfDay.toLowerCase()) {
            case 'morning':
                return { statusCode: 200, headers, body: JSON.stringify({ success: true, availableSlots: availableMorning }) };
            case 'afternoon':
                return { statusCode: 200, headers, body: JSON.stringify({ success: true, availableSlots: availableAfternoon }) };
            case 'evening':
                return { statusCode: 200, headers, body: JSON.stringify({ success: true, availableSlots: availableEvening }) };
            default:
                return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Invalid time of day specified. Please use 'morning', 'afternoon', or 'evening'." }) };
        }

    } catch (error: any) {
        console.error("Error in getAvailableSlots:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};
