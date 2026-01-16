// FILE: netlify/functions/getAvailableSlots.ts
import { supabase } from './lib/supabaseClient';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    // 1. Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    try {
        // 2. Parse and Validate Request
        const { doctorName, date, timeOfDay } = JSON.parse(event.body || '{}');
        if (!doctorName || !date) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ error: "Doctor name and date are required." }) 
            };
        }

        // 3. Fetch Doctor Schedule (Using centralized 'supabase' client)
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id, working_hours_start, working_hours_end')
            .ilike('name', `%${doctorName}%`)
            .single();

        if (doctorError || !doctorData) {
            return { 
                statusCode: 404, 
                headers, 
                body: JSON.stringify({ success: false, message: `Could not find a doctor named ${doctorName}.` }) 
            };
        }
        
        if (!doctorData.working_hours_start || !doctorData.working_hours_end) {
             return { 
                 statusCode: 404, 
                 headers, 
                 body: JSON.stringify({ success: false, message: `Schedule not found for ${doctorName}.` }) 
             };
        }

        // 4. Logic: Generate All Possible 30-Minute Slots
        const allPossibleSlots = [];
        const slotDuration = 30;
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

        // 5. Logic: Filter Out Existing Booked Appointments
        const { data: bookedAppointments, error: bookedError } = await supabase
            .from('appointments')
            .select('appointment_time')
            .eq('doctor_id', doctorData.id)
            .eq('appointment_date', date)
            .eq('status', 'confirmed');

        if (bookedError) throw bookedError;

        const bookedTimes = bookedAppointments.map(appt => appt.appointment_time.substring(0, 5));
        const availableSlots = allPossibleSlots.filter(slot => !bookedTimes.includes(slot));

        // 6. Logic: Group Slots by Period
        const availableMorning = availableSlots.filter(slot => parseInt(slot.split(':')[0]) < 12);
        const availableAfternoon = availableSlots.filter(slot => parseInt(slot.split(':')[0]) >= 12 && parseInt(slot.split(':')[0]) < 17);
        const availableEvening = availableSlots.filter(slot => parseInt(slot.split(':')[0]) >= 17);

        // 7. Response: General Availability Check (Period based)
        if (!timeOfDay) {
            const availablePeriods = [];
            if (availableMorning.length > 0) availablePeriods.push('morning');
            if (availableAfternoon.length > 0) availablePeriods.push('afternoon');
            if (availableEvening.length > 0) availablePeriods.push('evening');
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, availablePeriods }) };
        }

        // 8. Response: Specific Slots for a Period
        const period = timeOfDay.toLowerCase();
        if (period === 'morning') {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, availableSlots: availableMorning }) };
        }
        if (period === 'afternoon') {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, availableSlots: availableAfternoon }) };
        }
        if (period === 'evening') {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, availableSlots: availableEvening }) };
        }

        return { 
            statusCode: 400, 
            headers, 
            body: JSON.stringify({ success: false, message: "Invalid time of day specified." }) 
        };

    } catch (error: any) {
        console.error("Error in getAvailableSlots:", error.message);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ success: false, message: error.message }) 
        };
    }
};

export { handler };