// FILE: netlify/functions/bookAppointment.ts
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
        console.error("Missing Supabase configuration");
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ 
                success: false,
                error: "Database configuration error." 
            }) 
        };
    }

    try {
        const requestBody = JSON.parse(event.body || '{}');
        const { doctorName, patientName, date, time, phone } = requestBody;
        
        console.log("Booking appointment request:", { doctorName, patientName, date, time, phone });

        // Validate required fields
        const missingFields = [];
        if (!doctorName) missingFields.push('doctorName');
        if (!patientName) missingFields.push('patientName');
        if (!date) missingFields.push('date');
        if (!time) missingFields.push('time');
        if (!phone) missingFields.push('phone');

        if (missingFields.length > 0) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ 
                    success: false,
                    error: `Missing required fields: ${missingFields.join(', ')}`,
                    received: requestBody
                }) 
            };
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ 
                    success: false,
                    error: `Invalid date format. Expected YYYY-MM-DD, received: ${date}` 
                }) 
            };
        }

        // Validate time format (HH:MM)
        const timeRegex = /^\d{2}:\d{2}$/;
        if (!timeRegex.test(time)) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ 
                    success: false,
                    error: `Invalid time format. Expected HH:MM, received: ${time}` 
                }) 
            };
        }

        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        // Step 1: Find the doctor with exact name match
        console.log(`Looking for doctor: "${doctorName}"`);
        const { data: doctorData, error: doctorError } = await supabase
            .from('doctors')
            .select('id, name')
            .eq('name', doctorName.trim())
            .single();

        if (doctorError || !doctorData) {
            console.error("Doctor not found:", doctorError);
            
            // Try fuzzy search as fallback
            const { data: fuzzyDoctors, error: fuzzyError } = await supabase
                .from('doctors')
                .select('id, name')
                .ilike('name', `%${doctorName.trim()}%`)
                .limit(5);

            if (fuzzyError || !fuzzyDoctors || fuzzyDoctors.length === 0) {
                return { 
                    statusCode: 404, 
                    headers, 
                    body: JSON.stringify({ 
                        success: false, 
                        error: `Doctor "${doctorName}" not found in the system.` 
                    }) 
                };
            }

            // If we found similar doctors, suggest them
            const suggestions = fuzzyDoctors.map(doc => doc.name).join(', ');
            return { 
                statusCode: 404, 
                headers, 
                body: JSON.stringify({ 
                    success: false, 
                    error: `Doctor "${doctorName}" not found. Did you mean one of these: ${suggestions}?` 
                }) 
            };
        }

        console.log(`Found doctor: ${doctorData.name} (ID: ${doctorData.id})`);

        // Step 2: Check if the time slot is already booked
        const { data: existingAppointment, error: checkError } = await supabase
            .from('appointments')
            .select('id, patient_name')
            .eq('doctor_id', doctorData.id)
            .eq('appointment_date', date)
            .eq('appointment_time', time)
            .in('status', ['confirmed', 'pending'])
            .maybeSingle();

        if (checkError) {
            console.error("Error checking existing appointments:", checkError);
            throw checkError;
        }

        if (existingAppointment) {
            console.log("Time slot already booked:", existingAppointment);
            return { 
                statusCode: 409, 
                headers, 
                body: JSON.stringify({ 
                    success: false, 
                    message: `Sorry, the time slot ${time} on ${date} with Dr. ${doctorData.name} is already booked. Please choose another time.` 
                }) 
            };
        }

        // Step 3: Create the appointment
        const appointmentData = {
            patient_name: patientName.trim(),
            doctor_id: doctorData.id,
            appointment_date: date,
            appointment_time: time + ':00', // Ensure seconds are included
            phone: phone.trim(),
            status: 'confirmed',
            created_at: new Date().toISOString()
        };

        console.log("Creating appointment with data:", appointmentData);

        const { data: newAppointment, error: appointmentError } = await supabase
            .from('appointments')
            .insert(appointmentData)
            .select()
            .single();

        if (appointmentError) {
            console.error("Error creating appointment:", appointmentError);
            throw appointmentError;
        }

        console.log("Appointment created successfully:", newAppointment);

        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ 
                success: true, 
                message: `Appointment successfully booked with Dr. ${doctorData.name} on ${date} at ${time}.`,
                appointmentId: newAppointment.id,
                details: {
                    doctor: doctorData.name,
                    patient: patientName,
                    date: date,
                    time: time,
                    phone: phone
                }
            }) 
        };

    } catch (error: any) {
        console.error("Unexpected error in bookAppointment:", error);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ 
                success: false, 
                error: "Internal server error while booking appointment.",
                details: error.message 
            }) 
        };
    }
};

export { handler };