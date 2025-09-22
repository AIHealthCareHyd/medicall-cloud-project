// FILE: netlify/functions/getAiResponse.ts
import { GoogleGenerativeAI, ChatSession, FunctionDeclarationsTool } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// --- Helper Functions ---

const getFormattedDate = (date: Date): string => date.toISOString().split('T')[0];

const TOOLS: FunctionDeclarationsTool[] = [{
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
}];

/**
 * Creates the master instruction prompt for the AI.
 */
async function createSystemPrompt(): Promise<string> {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
    const { data: specialtiesData, error: specialtiesError } = await supabase.from('doctors').select('specialty');
    if (specialtiesError) throw specialtiesError;
    const specialtyList = [...new Set(specialtiesData.map(doc => doc.specialty))];
    const specialtyListString = specialtyList.join(', ');

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    const todayStr = getFormattedDate(today);
    const tomorrowStr = getFormattedDate(tomorrow);

    return `
    You are Sahay, a friendly, accurate, and highly disciplined AI medical appointment assistant for Prudence Hospitals.

    **Primary Instruction: You MUST conduct the entire conversation in Telugu.**

    **List of Available Specialties:**
    Here are the only specialties available at the hospital: [${specialtyListString}]

    **Core Rules (CRITICAL):**
    - Today's date is ${todayStr}. Tomorrow's date is ${tomorrowStr}.
    - You MUST silently convert natural language dates and times into 'YYYY-MM-DD' and 'HH:MM' formats before calling tools.
    - NEVER mention technical formats to the user.
    - If a tool call fails, do not mention the error. Apologize gracefully and suggest trying again or asking for something else.

    **Workflow for New Appointments (Follow STRICTLY):**
    1.  **Understand Need & Match Specialty:** Ask for symptoms. Silently match their request to the closest specialty from the list. It is forbidden to ask for confirmation or mention their spelling.
    2.  **Find & Present Real Doctors:** Immediately call 'getDoctorDetails' with the corrected specialty. You are FORBIDDEN from hallucinating doctor names. Present ONLY the real names returned by the tool.
    3.  **Get Choice & Date:** After the user confirms a doctor, ask for their preferred date.
    4.  **Check Schedule (Multi-Step):** First, call 'getAvailableSlots' to get periods (morning/afternoon). Ask for the user's preference, then call the tool again to get specific times.
    5.  **Gather Details & Confirm:** Get patient name/phone. Present a full summary and ask for one final confirmation.
    6.  **Execute Booking:** After their final "yes," your ONLY next action is to call the 'bookAppointment' tool.

    **Workflow for Cancellations:**
    1.  **Gather Details:** You MUST ask for and receive the patient's name, the doctor's name, and the appointment date.
    2.  **Confirm & Execute:** Confirm the details with the user, and after their "yes", you MUST call the 'cancelAppointment' tool.
    `;
}

/**
 * Initializes the Generative AI model and starts a chat session.
 */
function initializeChat(apiKey: string, systemPrompt: string, history: any[]): ChatSession {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", tools: TOOLS });
    
    const chatHistory = [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "model", parts: [{ text: "అర్థమైంది. నేను మీ సహాయకుడిగా ఉన్నాను. నేను మీకు ఎలా సహాయపడగలను?" }] },
        ...history.slice(0, -1)
    ];

    return model.startChat({ history: chatHistory });
}

/**
 * Handles the execution of tool function calls.
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
    if (!process.env.GEMINI_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "AI configuration error." }) };
    }
    
    try {
        const { history } = JSON.parse(event.body || '{}');
        if (!history || !Array.isArray(history) || history.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "No history provided." }) };
        }
        
        const systemPrompt = await createSystemPrompt();
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

