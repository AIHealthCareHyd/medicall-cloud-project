// FILE: netlify/functions/getAiResponse.ts
import { GoogleGenerativeAI, ChatSession } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const getFormattedDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
}

/**
 * Initializes the Generative AI model and starts a chat session with the provided history.
 */
function initializeChat(apiKey: string, systemPrompt: string, history: any[]): ChatSession {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        tools: [{
            functionDeclarations: [
                { 
                    name: "getAvailableSlots", 
                    description: "Gets available time slots for a doctor. If 'timeOfDay' is not provided, it returns available periods (morning, afternoon). If 'timeOfDay' IS provided, it returns specific times for that period.", 
                    parameters: { 
                        type: "OBJECT", 
                        properties: { 
                            doctorName: { type: "STRING" }, 
                            date: { type: "STRING" },
                            timeOfDay: { type: "STRING", description: "Optional. Can be 'morning', 'afternoon', or 'evening'." } 
                        }, 
                        required: ["doctorName", "date"] 
                    } 
                },
                { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                { name: "cancelAppointment", description: "Cancels an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] } },
                { name: "rescheduleAppointment", description: "Reschedules an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" } }, required: ["doctorName", "patientName", "oldDate", "newDate", "newTime"] } },
            ],
        }],
    }); 
    
    const chatHistory = [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "model", parts: [{ text: "అర్థమైంది. నేను స్పెల్లింగ్ తప్పులను అంతర్గతంగా సరిచేసి, నిర్ధారణ కోసం అడగకుండా నేరుగా డాక్టర్‌ను కనుగొంటాను. నేను మీకు ఎలా సహాయపడగలను?" }] },
        ...history.slice(0, -1)
    ];

    return model.startChat({ history: chatHistory });
}

/**
 * Handles the execution of tool function calls determined by the AI model.
 */
async function handleToolCalls(functionCalls: any[], chat: ChatSession, event: HandlerEvent): Promise<string> {
    const call = functionCalls[0];
    const host = event.headers.host || 'sahayhealth.netlify.app';
    const toolUrl = `https://${host}/.netlify/functions/${call.name}`;
    
    const toolResponse = await fetch(toolUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(call.args),
    });

    let toolResult;
    if (!toolResponse.ok) {
        toolResult = { error: `Tool call to ${call.name} failed with status ${toolResponse.status}` };
    } else {
        toolResult = await toolResponse.json();
    }

    const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }]);
    return result2.response.text();
}

// --- Main Netlify Function Handler ---
export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    if (!process.env.GEMINI_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Configuration error." }) };
    }
    
    try {
        const body = JSON.parse(event.body || '{}');
        const { history } = body;

        if (!history || !Array.isArray(history) || history.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "No history provided." }) };
        }
        
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        const { data: specialtiesData, error: specialtiesError } = await supabase.from('doctors').select('specialty');
        if (specialtiesError) throw specialtiesError;
        const specialtyList = [...new Set(specialtiesData.map(doc => doc.specialty))];
        const specialtyListString = specialtyList.join(', ');

        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);
        const todayStr = getFormattedDate(today);
        const tomorrowStr = getFormattedDate(tomorrow);

        const systemPrompt = `
        You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

        **Primary Instruction: You MUST conduct the entire conversation in Telugu.**

        **List of Available Specialties:**
        Here are the only specialties available at the hospital: [${specialtyListString}]

        **Internal Rules (CRITICAL):**
        - Today's date is ${todayStr}. Tomorrow's date is ${tomorrowStr}.
        - You MUST silently convert natural language dates and times into 'YYYY-MM-DD' and 'HH:MM' formats before calling tools.
        - NEVER mention technical formats to the user.

        **Workflow for All Tasks (Follow this order STRICTLY):**
        1.  **Understand Need:** Ask the user what they need (book, cancel, reschedule).
        2.  **Match Specialty (For Booking):** If booking, silently find the closest match from your 'List of Available Specialties'. It is forbidden to ask for confirmation.
        3.  **Find & Present Real Doctors (For Booking):** Immediately call 'getDoctorDetails' with the corrected specialty. You are FORBIDDEN from hallucinating doctor names. Present ONLY the real names returned by the tool.
        4.  **Gather ALL Necessary Information:** Before executing ANY tool, you must gather all the required details from the user (e.g., patient name, doctor name, date for cancellation; new time for rescheduling).
        5.  **Confirm Details:** For any action, present a complete summary of the details to the user and ask for a final confirmation (e.g., "అంతా సరిగ్గా ఉందా?").
        6.  **Execute Final Action:** After the user's final "yes" or "ok", your ONLY next action is to call the correct tool ('bookAppointment', 'cancelAppointment', 'rescheduleAppointment'). You MUST call the tool.
        `;

        const chat = initializeChat(process.env.GEMINI_API_KEY, systemPrompt, history);
        const latestUserMessage = history[history.length - 1].parts[0].text;

        const result = await chat.sendMessage(latestUserMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        let finalReply: string;

        if (functionCalls && functionCalls.length > 0) {
            finalReply = await handleToolCalls(functionCalls, chat, event);
        } else {
            finalReply = response.text();
        }

        return { statusCode: 200, headers, body: JSON.stringify({ reply: finalReply }) };

    } catch (error: any) {
        console.error("FATAL: Error in getAiResponse handler.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Failed to process request: ${error.message}` }) };
    }
};

