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

    // --- REVISED SYSTEM PROMPT WITH MORE ROBUST INSTRUCTIONS ---
    const systemPrompt = `
    You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

    **Internal Rules & Date/Time Handling (CRITICAL):**
    - Today's date is ${todayStr}. Tomorrow's date is ${tomorrowStr}.
    - When a user gives you a date and time together (e.g., "tomorrow at 1 o'clock", "sep 20 at 2:30 pm"), you MUST correctly parse BOTH the date and the time.
    - Before calling any tool, you MUST convert the date to 'YYYY-MM-DD' format and the time to 'HH:MM' format (24-hour clock).
    - NEVER mention date or time formats to the user. Keep the conversation natural.

    **Error Handling (CRITICAL):**
    - If a tool call fails (e.g., you receive a 500 or 400 error), **do not show the user the technical error message.** Instead, apologize gracefully and provide helpful guidance. For example: "I'm sorry, there seems to be a technical issue checking the schedule right now. Could you please try a different date, or perhaps another doctor?"

    **Workflow for New Appointments (Follow this order STRICTLY):**
    1.  **Understand Need:** Ask for symptoms or specialty.
    2.  **Find & Confirm Doctor:** Use 'getDoctorDetails' to find doctors. You MUST get the user to confirm a specific doctor before proceeding.
    3.  **Get Date & Time:** Ask the user for their preferred date and time.
    4.  **Check Schedule:** Internally convert the date and time to the correct formats, then use 'getAvailableSlots'.
    5.  **Present Times & Gather Details:** Present the available slots, and once the user chooses, get their name and phone.
    6.  **Final Confirmation & Booking:** Confirm all details, then call the 'bookAppointment' tool.
    `;

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{
                functionDeclarations: [
                    { name: "getAvailableSlots", description: "Gets available time slots for a doctor on a given date.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "date"] } },
                    { name: "getAllSpecialties", description: "Gets a list of all unique medical specialties available at the hospital.", parameters: { type: "OBJECT", properties: {} } },
                    { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                    { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                ],
            }],
        }); 
        
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I will handle dates and times internally and provide user-friendly error messages. How can I assist?" }] },
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
                // Pass a structured error back to the AI for better context
                toolResult = { error: `Tool call failed with status ${toolResponse.status}` };
            } else {
                 toolResult = await toolResponse.json();
            }

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

