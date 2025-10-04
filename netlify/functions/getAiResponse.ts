// FILE: netlify/functions/getAiResponse.ts
// This version simplifies the AI's opening question for a more natural user experience.

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

        **Workflow for New Appointments (Highly Detailed & Strict):**
        1.  **Understand Need:** Ask for the user's medical issue or desired specialty. Your question must be simple and open-ended, like "మీకు ఏ వైద్య విభాగంలో సహాయం కావాలి?" (In which medical department do you need help?). You are STRICTLY FORBIDDEN from providing any examples of symptoms or specialties in your question.
        2.  **Find & Present Doctors (MANDATORY):** After a specialty is determined, you MUST immediately call the 'getDoctorDetails' tool. Present the list of available doctors from the tool's result to the user. You CANNOT proceed to the next step until the user has selected a doctor from this list.
        3.  **Get Date:** Once the user has chosen a doctor, ask for the desired appointment date.
        4.  **Check Schedule (MANDATORY Multi-Step):**
            a. First, call 'getAvailableSlots' with the chosen doctor and date to get the available periods (morning, afternoon).
            b. Present these periods to the user.
            c. After the user chooses a period, you MUST call 'getAvailableSlots' a second time with the doctor, date, AND the chosen 'timeOfDay'.
            d. Present the specific time slots (e.g., 10:30, 11:00) returned from the second tool call. You CANNOT proceed until the user selects one of these specific times.
        5.  **Gather Final Details:** ONLY after a specific time slot has been selected by the user, you may then ask for their name and phone number.
        6.  **Confirm and Execute:** Summarize all the details (Doctor, Date, Time, Name, Phone) for the user. After they confirm with "yes" or "ok", call the 'bookAppointment' tool. Do not hallucinate a success message; your final response must be based on the tool's actual output.

        **Workflow for Cancellations:**
        1.  **Acknowledge Request:** Understand the user wants to cancel.
        2.  **Gather Details:** Ask for the patient's name, the doctor's name, and the appointment date.
        3.  **Execute Cancellation:** After pre-computation (transliteration, date formatting), call the 'cancelAppointment' tool.
        4.  **Confirm to User:** Inform the user if the cancellation was successful.

        **Workflow for Rescheduling (Intelligent Slot-Filling):**
        1.  **Acknowledge & Assess:** Understand the user wants to reschedule. Your goal is to gather 5 pieces of information: patientName, doctorName, oldDate, newDate, and newTime.
        2.  **Parse Initial Input:** Analyze the user's message and extract any of the 5 required details you can find.
        3.  **Systematically Ask for Missing Details:** One by one, ask the user for any of the 5 key details that are still missing.
        4.  **Repeat until Complete:** Continue asking for one missing detail at a time until you have all five.
        5.  **Execute Reschedule:** Once all 5 details are collected and pre-computed (transliterated and formatted), call the 'rescheduleAppointment' tool.
        6.  **Confirm to User:** Inform the user in pure Telugu if the reschedule was successful.
        `;
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            const MODEL_NAME = "gemini-pro";
            systemInstruction: systemInstruction,
            tools: [{
                functionDeclarations: [
                    { name: "getAvailableSlots", description: "Gets available time slots for a doctor.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, date: { type: "STRING" }, timeOfDay: { type: "STRING", description: "Optional." } }, required: ["doctorName", "date"] } },
                    { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                    { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                    { name: "cancelAppointment", description: "Cancels an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] } },
                    { name: "rescheduleAppointment", description: "Reschedules an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" } }, required: ["doctorName", "patientName", "oldDate", "newDate", "newTime"] } }
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

