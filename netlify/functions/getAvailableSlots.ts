// FILE: netlify/functions/getAiResponse.ts
import { GoogleGenerativeAI, ChatSession } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

/**
 * Initializes the Generative AI model and starts a chat session.
 */
function initializeChat(apiKey: string, systemPrompt: string, history: any[]): ChatSession {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        tools: {
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
                { name: "getAllSpecialties", description: "Gets a list of all unique medical specialties available at the hospital.", parameters: { type: "OBJECT", properties: {} } },
                { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                { name: "cancelAppointment", description: "Cancels an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] } },
                { name: "rescheduleAppointment", description: "Reschedules an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" } }, required: ["doctorName", "patientName", "oldDate", "newDate", "newTime"] } },
            ]
        }
    }); 
    
    // Construct the initial chat history
    const chatHistory = [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "model", parts: [{ text: "Understood. I will follow the multi-step process for checking schedules. How can I help you book an appointment today?" }] },
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

    if (!toolResponse.ok) {
        const errorText = await toolResponse.text();
        console.error(`Tool call to ${call.name} failed with status ${toolResponse.status}: ${errorText}`);
        throw new Error(`Tool call to ${call.name} failed.`);
    }

    const toolResult = await toolResponse.json();

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
        const body = JSON.parse(event.body || '{}');
        const { history } = body;

        if (!history || !Array.isArray(history) || history.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "No history provided." }) };
        }
        
        const currentDate = new Date().toLocaleDateString('en-CA');
        const systemPrompt = `
        You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

        **Workflow for New Appointments:**
        1.  **Understand Need:** Ask for symptoms or specialty.
        2.  **Find Doctor:** Use 'getDoctorDetails' to find a doctor. Once the user confirms, proceed.
        3.  **Get Date:** Ask the user for their preferred date.
        4.  **Check Schedule (CRITICAL MULTI-STEP PROCESS):**
            a. **First Call:** Call the 'getAvailableSlots' tool with ONLY the doctor's name and date. The tool will return available periods (e.g., ["morning", "afternoon"]).
            b. **Ask User:** Based on the returned periods, ask the user for their preference. For example: "The doctor has openings in the morning and afternoon. Do you have a preference?"
            c. **Second Call:** Once the user responds (e.g., "morning"), call the 'getAvailableSlots' tool AGAIN. This time, include their choice. (e.g., doctorName, date, and timeOfDay: 'morning').
            d. **Present Specific Times:** The tool will now return a short list of specific times. Present these options to the user.
        5.  **Gather Final Details:** After they pick a time, get the patient's name and phone number.
        6.  **Final Confirmation & Booking:** Confirm all details, then call the 'bookAppointment' tool.
        
        **Other Rules:**
        - If the first 'getAvailableSlots' call returns an empty list, the doctor is fully booked. Inform the user.
        - Today's date is ${currentDate}.
        - Do not provide medical advice.
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