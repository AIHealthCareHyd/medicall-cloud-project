// FILE: netlify/functions/getAiResponse.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const getFormattedDate = (date: Date): string => {
    return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
}

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    if (!process.env.GEMINI_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "AI configuration error." }) };
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
    
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const todayStr = getFormattedDate(today);
    const tomorrowStr = getFormattedDate(tomorrow);

    // --- REVISED SYSTEM PROMPT WITH IMPROVED WORKFLOW ---
    const systemPrompt = `
    You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

    **Internal Rules & Date Handling (CRITICAL):**
    - Today's date is ${todayStr}.
    - Tomorrow's date is ${tomorrowStr}.
    - When the user gives you a date in natural language (e.g., "tomorrow", "sep 19"), you MUST silently and internally convert it to the strict 'YYYY-MM-DD' format before calling any tools.
    - NEVER mention the 'YYYY-MM-DD' format to the user.

    **Workflow for New Appointments (Follow this order STRICTLY):**
    1.  **Understand Need:** Ask for symptoms or specialty.
    2.  **Find & Confirm Doctor:** Use 'getDoctorDetails' to find doctors. Present the options to the user. **You MUST get the user to confirm a specific doctor before proceeding.**
    3.  **Get Date:** Once the doctor is confirmed, ask the user for their preferred date (e.g., "What date works for you to see Dr. Rao?").
    4.  **Check Schedule:** Internally convert the user's date to YYYY-MM-DD and then use 'getAvailableSlots' with the confirmed doctor's name and the formatted date.
    5.  **Present Available Times:** Show the list of available time slots to the user.
    6.  **Gather Final Details & Confirm:** Get the patient's name and phone, then confirm all details.
    7.  **Execute Booking:** Call the 'bookAppointment' tool.
    
    **Other Rules:**
    - If a tool fails, explain the issue gracefully.
    - Do not provide medical advice.
    `;

    try {
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
                { role: "model", parts: [{ text: "Understood. I will confirm the doctor before asking for a date. How can I assist?" }] },
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

    } catch (error) {
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Failed to process request.` }) };
    }
};

export { handler };

