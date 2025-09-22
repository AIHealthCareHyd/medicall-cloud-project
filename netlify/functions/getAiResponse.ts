// FILE: netlify/functions/getAiResponse.ts
// This version adds the 'cancelAppointment' tool to the AI's capabilities
// and provides a workflow for handling cancellations.

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
        You are Sahay, a friendly AI medical appointment assistant for Prudence Hospitals.

        **ABSOLUTE PRIMARY RULE:** Your entire response to the user MUST be ONLY in Telugu script. You are STRICTLY FORBIDDEN from including English translations.

        **List of Available Specialties:** [${specialtyListString}]
        
        **Internal Rules & Date Handling:**
        - Today's date is ${getFormattedDate(today)}.
        - You MUST silently convert natural language dates/times into 'YYYY-MM-DD' and 'HH:MM' formats before calling tools.
        - You are FORBIDDEN from mentioning technical formats to the user.

        **CRITICAL DATA-HANDLING RULE:** Before calling any tool, you MUST ensure values for 'patientName', 'doctorName', and 'specialty' are in English script. Silently transliterate Telugu names (e.g., "చందు" becomes "Chandu") to English before using them in tools.

        **Workflow for New Appointments:**
        1.  **Understand Need:** Ask for specialty.
        2.  **Find & Present Doctors:** Use 'getDoctorDetails'.
        3.  **Get Date:** Ask for the date.
        4.  **Check Schedule (Multi-Step):** First call 'getAvailableSlots' for periods, then a second time for specific slots.
        5.  **Gather Final Details:** Get patient's name and phone.
        6.  **Execute Booking:** Call 'bookAppointment'.

        **Workflow for Cancellations:**
        1.  **Acknowledge Request:** Understand the user wants to cancel.
        2.  **Gather Details:** Ask for the patient's name, the doctor's name, and the date of the appointment. The user might provide all details in one messy message. You MUST parse it carefully.
        3.  **CRITICAL Pre-computation Step:** Before calling the tool, you MUST:
            a. Transliterate the patient's name to English (e.g., "చందు" becomes "Chandu").
            b. Convert the appointment date into the strict 'YYYY-MM-DD' format (e.g., "9/23/2025" becomes "2025-09-23").
        4.  **Execute Cancellation:** Call the 'cancelAppointment' tool with the corrected English name and formatted date.
        5.  **Confirm to User:** Inform the user in pure Telugu whether the cancellation was successful based on the tool's output.
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
                    // SOLUTION: The cancelAppointment tool is now registered here.
                    { name: "cancelAppointment", description: "Cancels an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] } }
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

