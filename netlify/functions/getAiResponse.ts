// FILE: netlify/functions/getAiResponse.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

/**
 * Utility to format dates for the AI's internal reasoning
 */
const getFormattedDate = (date: Date): string => {
    return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
}

const handler: Handler = async (event: HandlerEvent) => {
    // 1. Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    // 2. Validate Configuration
    if (!process.env.GEMINI_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "AI configuration error." }) };
    }

    // 3. Parse Request Body
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
    
    // 4. Set Dynamic Context
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const todayStr = getFormattedDate(today);
    const tomorrowStr = getFormattedDate(tomorrow);

    const systemPrompt = `
    You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

    **Primary Instruction: You MUST conduct the entire conversation in Telugu.** All of your responses must be in the Telugu language.

    **Internal Rules & Date Handling (CRITICAL):**
    - Today's date is ${todayStr}.
    - Tomorrow's date is ${tomorrowStr}.
    - When the user gives you a date in natural language (e.g., "రేపు", "సెప్టెంబర్ 19"), you MUST silently and internally convert it to the strict 'YYYY-MM-DD' format before calling any tools.
    - NEVER mention the 'YYYY-MM-DD' format to the user. Keep the conversation natural.

    **Workflow (in Telugu):**
    1. **Understand Need:** Ask for symptoms or specialty.
    2. **Find & Confirm Doctor:** Use 'getDoctorDetails' to find doctors.
    3. **Check Availability:** Use 'getAvailableSlots'.
    4. **Booking:** Call 'bookAppointment'.
    5. **Manage Existing:** Call 'cancelAppointment' or 'rescheduleAppointment' as requested.
    `;

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{
                functionDeclarations: [
                    { name: "getAvailableSlots", description: "Gets available time slots for a doctor on a given date.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, date: { type: "STRING" }, timeOfDay: { type: "STRING", enum: ["morning", "afternoon", "evening"] } }, required: ["doctorName", "date"] } },
                    { name: "getAllSpecialties", description: "Gets a list of all unique medical specialties available at the hospital.", parameters: { type: "OBJECT", properties: {} } },
                    { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                    { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                    { name: "cancelAppointment", description: "Cancels an existing appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] } },
                    { name: "rescheduleAppointment", description: "Moves an existing appointment to a new date/time.", parameters: { type: "OBJECT", properties: { patientName: { type: "STRING" }, doctorName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" } }, required: ["patientName", "doctorName", "oldDate", "newDate", "newTime"] } },
                ],
            }],
        }); 
        
        // 5. Start Conversation
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

        // 6. Handle Tool Use (Function Calling)
        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            let toolResult;

            // Resolve the tool URL dynamically
            const host = event.headers.host || 'sahayhealth.netlify.app';
            const protocol = host.includes('localhost') ? 'http' : 'https';
            const toolUrl = `${protocol}://${host}/.netlify/functions/${call.name}`;
            
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

            // Feed tool result back to Gemini for final Telugu response
            const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }]);
            const finalResponse = result2.response.text();
            
            return { statusCode: 200, headers, body: JSON.stringify({ reply: finalResponse }) };
        }

        // 7. Standard Text Response
        const text = response.text();
        return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };

    } catch (error: any) {
        console.error("BRAIN_FATAL:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Failed to process request.` }) };
    }
};

export { handler };