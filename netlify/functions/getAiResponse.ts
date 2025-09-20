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

    // --- CHANGE IS HERE: The entire prompt is updated to enforce Telugu ---
    const systemPrompt = `
    You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

    **Primary Instruction: You MUST conduct the entire conversation in Telugu.** All of your responses must be in the Telugu language.

    **Internal Rules & Date Handling (CRITICAL):**
    - Today's date is ${todayStr}.
    - Tomorrow's date is ${tomorrowStr}.
    - When the user gives you a date in natural language (e.g., "రేపు", "సెప్టెంబర్ 19"), you MUST silently and internally convert it to the strict 'YYYY-MM-DD' format before calling any tools.
    - NEVER mention the 'YYYY-MM-DD' format to the user. Keep the conversation natural.

    **Workflow for New Appointments (in Telugu):**
    1.  **Understand Need:** Ask for symptoms or specialty.
    2.  **Find & Confirm Doctor:** Use 'getDoctorDetails' to find doctors. You MUST get the user to confirm a specific doctor.
    3.  **Get Date:** Once the doctor is confirmed, ask for their preferred date.
    4.  **Check Schedule:** Internally convert the date and use 'getAvailableSlots'.
    5.  **Present Times & Gather Details:** Present the available slots, then get the patient's name and phone.
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
                { role: "model", parts: [{ text: "అర్థమైంది. నేను సంభాషణను తెలుగులో నిర్వహిస్తాను. నేను మీకు ఎలా సహాయపడగలను?" }] },
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

