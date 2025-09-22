// FILE: netlify/functions/getAiResponse.ts
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

// --- PROFESSIONAL-GRADE REFINEMENTS ---

// 1. In-memory cache for session histories and static data.
// In a real production environment, you would replace this with Redis, a Supabase table, or another persistent cache.
const sessionCache = new Map<string, any[]>();
const specialtyCache = {
    specialties: null as string[] | null,
    lastFetched: 0,
    ttl: 3600 * 1000 // Cache for 1 hour
};

// 2. A single, shared Supabase client instance.
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
);

// --- END REFINEMENTS ---

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

const getFormattedDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
}

const getSpecialties = async (): Promise<string[]> => {
    const now = Date.now();
    if (specialtyCache.specialties && (now - specialtyCache.lastFetched < specialtyCache.ttl)) {
        console.log("CACHE HIT: Returning specialties from cache.");
        return specialtyCache.specialties;
    }

    console.log("CACHE MISS: Fetching specialties from database.");
    const { data, error } = await supabase.from('doctors').select('specialty');
    if (error) {
        console.error("Error fetching specialties:", error);
        return []; // Return empty on error
    }

    const uniqueSpecialties = [...new Set(data.map(doc => doc.specialty))];
    specialtyCache.specialties = uniqueSpecialties;
    specialtyCache.lastFetched = now;
    return uniqueSpecialties;
};

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    if (!process.env.GEMINI_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Configuration error." }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }

    // REVISED: Expect sessionId and userMessage instead of full history
    const { sessionId, userMessage } = body;
    if (!sessionId || !userMessage) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "sessionId and userMessage are required." }) };
    }

    try {
        const specialtyList = await getSpecialties();
        const specialtyListString = specialtyList.join(', ');

        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);

        // REVISED: Use the proper `systemInstruction` field for better model guidance.
        const systemInstruction = `
            You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

            **Primary Instruction: You MUST conduct the entire conversation in Telugu.**

            **List of Available Specialties:**
            Here are the only specialties available at the hospital: [${specialtyListString}]

            **Internal Rules & Date Handling (CRITICAL):**
            - Today's date is ${getFormattedDate(today)}. Tomorrow's date is ${getFormattedDate(tomorrow)}.
            - You MUST silently convert natural language dates (e.g., "రేపు") and times (e.g., "1 గంటకు") into 'YYYY-MM-DD' and 'HH:MM' formats before calling tools.
            - NEVER mention date or time formats to the user.

            **Workflow for New Appointments (Follow this order STRICTLY):**
            1.  **Understand Need:** Ask for symptoms or specialty in Telugu.
            2.  **Find & Present Real Doctors (CRITICAL ANTI-HALLUCINATION WORKFLOW):**
                a. **Silently Match Specialty:** Take the user's input (e.g., "gasentrology"). Silently and confidently find the closest match from your 'List of Available Specialties' (e.g., "Surgical Gastroenterology"). It is forbidden to ask for confirmation or mention the user's spelling.
                b. **Immediately Call Tool:** You MUST immediately use this corrected specialty to call the 'getDoctorDetails' tool.
                c. **Present ONLY Real Data:** The tool will return a list of real doctors. You are FORBIDDEN from inventing, hallucinating, or suggesting any doctor's name that was not in the tool's output. You MUST present only the exact, real names from the list to the user.
            3.  **Get User's Choice & Date:** Once the user confirms a doctor from the real list, ask for their preferred date.
            4.  **Check Schedule (Multi-Step):**
                a. First, call 'getAvailableSlots' to get available periods (morning/afternoon).
                b. Ask the user for their preference.
                c. Call 'getAvailableSlots' again with their preference to get specific times.
                d. Present the specific times to the user.
            5.  **Gather Final Details & Confirm:** Get the patient's name and phone, then confirm all details in Telugu.
            6.  **Execute Booking:** After the user gives their final "yes" or "ok", your final action MUST be to call the 'bookAppointment' tool to save the appointment to the database.
        `;
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // REVISED: Model initialization with system instruction
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: systemInstruction,
            tools: [{
                // Your function declarations are well-defined, no changes needed here.
                functionDeclarations: [
                    { name: "getAvailableSlots", description: "Gets available time slots for a doctor. If 'timeOfDay' is not provided, it returns available periods. If 'timeOfDay' IS provided, it returns specific times.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, date: { type: "STRING" }, timeOfDay: { type: "STRING", description: "Optional. Can be 'morning', 'afternoon', or 'evening'." } }, required: ["doctorName", "date"] } },
                    { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                    { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                ]
            }],
        });
        
        // REVISED: Retrieve history from cache
        const history = sessionCache.get(sessionId) || [];
        const chat = model.startChat({ history });

        const result = await chat.sendMessage(userMessage);
        
        // This part of your logic for handling function calls is solid.
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            const host = event.headers.host || 'sahayhealth.netlify.app';
            const toolUrl = `https://${host}/.netlify/functions/${call.name}`;
            
            const toolResponse = await fetch(toolUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(call.args),
            });
            
            const toolResult = toolResponse.ok ? await toolResponse.json() : { error: `Tool call failed with status ${toolResponse.status}` };

            const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }]);
            const finalResponse = result2.response.text();
            
            // REVISED: Update history in cache
            sessionCache.set(sessionId, await chat.getHistory());
            return { statusCode: 200, headers, body: JSON.stringify({ reply: finalResponse }) };
        }

        const text = response.text();
        // REVISED: Update history in cache
        sessionCache.set(sessionId, await chat.getHistory());
        return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };

    } catch (error: any) {
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Failed to process request.` }) };
    }
};

export { handler };