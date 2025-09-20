// FILE: netlify/functions/getAiResponse.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js'; // Import Supabase client
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const getFormattedDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
}

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    if (!process.env.GEMINI_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Configuration error." }) };
    }
    
    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }
    
    const { history } = body;
    if (!history || !Array.isArray(history) || history.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No history provided." }) };
    }
    
    try {
        // --- CHANGE IS HERE: Fetch specialties dynamically before building the prompt ---
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        const { data: specialtiesData, error: specialtiesError } = await supabase.from('doctors').select('specialty');
        if (specialtiesError) throw specialtiesError;
        const specialtyList = [...new Set(specialtiesData.map(doc => doc.specialty))];
        const specialtyListString = specialtyList.join(', ');
        // --- END OF CHANGE ---

        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);
        const todayStr = getFormattedDate(today);
        const tomorrowStr = getFormattedDate(tomorrow);

        const systemPrompt = `
        You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

        **List of Available Specialties:**
        Here are the only specialties available at the hospital: [${specialtyListString}]

        **Internal Rules & Date Handling (CRITICAL):**
        - Today's date is ${todayStr}. Tomorrow's date is ${tomorrowStr}.
        - You MUST silently convert natural language dates (e.g., "tomorrow") to 'YYYY-MM-DD' format before calling tools.
        - NEVER mention the 'YYYY-MM-DD' format to the user. Keep the conversation natural.

        **Workflow for New Appointments (Follow this order STRICTLY):**
        1.  **Understand Need:** Ask for symptoms or specialty.
        2.  **Match Specialty (CRITICAL STEP):** Look at the user's request and find the **closest match** from the 'List of Available Specialties' above. For example, if the user says "stomach doctor" or "gastroenterologist", you must choose "Surgical Gastroenterology" from the list.
        3.  **Find & Confirm Doctor:** Use the 'getDoctorDetails' tool with the **exact specialty string** you chose from the list. Present the options to the user. **You MUST get the user to confirm a specific doctor before proceeding.**
        4.  **Get Date:** Once the doctor is confirmed, ask the user for their preferred date.
        5.  **Check Schedule:** Internally convert the date and use 'getAvailableSlots'.
        6.  **Present Times & Gather Details:** Present the available slots, and once the user chooses, get their name and phone.
        7.  **Final Confirmation & Booking:** Confirm all details, then call the 'bookAppointment' tool.
        `;

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{
                functionDeclarations: [
                    { name: "getAvailableSlots", description: "Gets the available appointment time slots for a specific doctor on a given date.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "date"] } },
                    { name: "getAllSpecialties", description: "Gets a list of all unique medical specialties available at the hospital.", parameters: { type: "OBJECT", properties: {} } },
                    { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                    { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                    { name: "cancelAppointment", description: "Cancels an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] } },
                    { name: "rescheduleAppointment", description: "Reschedules an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" } }, required: ["doctorName", "patientName", "oldDate", "newDate", "newTime"] } },
                ],
            }],
        }); 
        
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I will use the provided list to match specialties before searching. How can I assist?" }] },
                ...history.slice(0, -1)
            ]
        });

        const latestUserMessage = history[history.length - 1].parts[0].text;

        const result = await chat.sendMessage(latestUserMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            let toolResult;
            const host = event.headers.host || 'sahayhealth.netlify.app';
            const toolUrl = `https://${host}/.netlify/functions/${call.name}`;
            
            const toolResponse = await fetch(toolUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(call.args),
            });
             if (!toolResponse.ok) {
                throw new Error(`Tool call to ${call.name} failed with status ${toolResponse.status}`);
            }
            toolResult = await toolResponse.json();

            const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }]);
            const finalResponse = result2.response.text();
            return { statusCode: 200, headers, body: JSON.stringify({ reply: finalResponse }) };
        }

        const text = response.text();
        return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };

    } catch (error: any) {
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Failed to process request.` }) };
    }
};

export { handler };

