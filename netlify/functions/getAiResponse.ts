// FILE: netlify/functions/getAiResponse.ts
// This version adds a critical instruction for the AI to transliterate
// patient names from Telugu to English before booking.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

const specialtyCache = {
    specialties: null as string[] | null,
    lastFetched: 0,
    ttl: 3600 * 1000
};

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

const getFormattedDate = (date: Date): string => date.toISOString().split('T')[0];

const getSpecialties = async (): Promise<string[]> => {
    const now = Date.now();
    if (specialtyCache.specialties && (now - specialtyCache.lastFetched < specialtyCache.ttl)) {
        return specialtyCache.specialties;
    }
    const { data, error } = await supabase.from('doctors').select('specialty');
    if (error) { console.error("Error fetching specialties:", error); return []; }
    const uniqueSpecialties = [...new Set(data.map(doc => doc.specialty))];
    specialtyCache.specialties = uniqueSpecialties;
    specialtyCache.lastFetched = now;
    return uniqueSpecialties;
};

async function getHistoryFromSupabase(sessionId: string): Promise<any[]> {
    const { data, error } = await supabase.from('conversations').select('history').eq('session_id', sessionId).single();
    if (error && error.code !== 'PGRST116') { console.error("Error fetching history:", error); return []; }
    return data?.history || [];
}

async function saveHistoryToSupabase(sessionId: string, history: any[]): Promise<void> {
    const { error } = await supabase.from('conversations').upsert({ session_id: sessionId, history: history, last_updated: new Date().toISOString() });
    if (error) { console.error("Error saving history:", error); }
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }
    if (!process.env.GEMINI_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Configuration error." }) };
    }

    const { sessionId, userMessage } = JSON.parse(event.body || '{}');
    if (!sessionId || !userMessage) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "sessionId and userMessage are required." }) };
    }

    try {
        const specialtyListString = (await getSpecialties()).join(', ');
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const systemInstruction = `
        You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.
        **Primary Instruction: You MUST conduct the entire conversation in Telugu.**
        **List of Available Specialties:** [${specialtyListString}]
        
        **Internal Rules & Date Handling (CRITICAL):**
        - Today's date is ${getFormattedDate(today)}. Tomorrow's date is ${getFormattedDate(tomorrow)}.
        - You MUST silently convert natural language dates/times into 'YYYY-MM-DD' and 'HH:MM' formats before calling tools.
        - **CRITICAL USER EXPERIENCE RULE:** You are FORBIDDEN from mentioning technical formats. It is your job to understand natural language like "రేపు" (tomorrow) and silently convert it. NEVER ask the user to provide data in a specific format.

        **Workflow for New Appointments (Follow this order STRICTLY):**
        1.  **Understand Need:** Ask for symptoms or specialty in Telugu.
        2.  **Find & Present Real Doctors:** Use the 'getDoctorDetails' tool and present ONLY the real names returned.
        3.  **Get User's Choice & Date:** After user picks a doctor, ask for their preferred date naturally.
        4.  **Check Schedule (Multi-Step):** Use 'getAvailableSlots' first without 'timeOfDay' to get periods, then again with the user's preference to get specific times.
        5.  **Gather Final Details & Confirm:**
            a. Get the patient's name and phone number. The user may provide the name in Telugu script (e.g., "చందు").
            b. **CRITICAL DATA-HANDLING STEP:** Before confirming, you MUST transliterate the patient's Telugu name into its English spelling (e.g., "చందు" becomes "Chandu", "సంపత్" becomes "Sampath").
            c. You will then use this English name for the confirmation summary and for the 'bookAppointment' tool call.
        6.  **Execute Booking (MANDATORY FINAL ACTION):** After the user's final "yes" or "ok", your ONLY action is to call the 'bookAppointment' tool. This is a terminal action.
        `;
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: systemInstruction,
            tools: [{
                functionDeclarations: [
                    { name: "getAvailableSlots", description: "Gets available time slots for a doctor.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, date: { type: "STRING" }, timeOfDay: { type: "STRING", description: "Optional." } }, required: ["doctorName", "date"] } },
                    { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                    { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                ]
            }],
        });
        
        const history = await getHistoryFromSupabase(sessionId);
        const chat = model.startChat({ history });
        const result = await chat.sendMessage(userMessage);
        
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const host = event.headers.host || 'sahayhealth.netlify.app';
            
            const toolPromises = functionCalls.map(call => {
                const toolUrl = `https://${host}/.netlify/functions/${call.name}`;
                return fetch(toolUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(call.args),
                }).then(async toolResponse => {
                    const toolResult = toolResponse.ok ? await toolResponse.json() : { error: `Tool call to ${call.name} failed with status ${toolResponse.status}` };
                    return { functionResponse: { name: call.name, response: toolResult } };
                });
            });

            const toolResponses = await Promise.all(toolPromises);
            const result2 = await chat.sendMessage(toolResponses);
await saveHistoryToSupabase(sessionId, await chat.getHistory());
            
            return { statusCode: 200, headers, body: JSON.stringify({ reply: result2.response.text() }) };
        }

await saveHistoryToSupabase(sessionId, await chat.getHistory());
        return { statusCode: 200, headers, body: JSON.stringify({ reply: response.text() }) };

    } catch (error: any) {
        console.error("FATAL: Error in getAiResponse.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Failed to process request.` }) };
    }
};
