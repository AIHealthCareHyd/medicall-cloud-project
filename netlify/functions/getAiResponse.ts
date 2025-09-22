// FILE: netlify/functions/getAiResponse.ts
// THIS IS THE FINAL, COMPLETE, AND ROBUST VERSION.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

// Use a single, shared Supabase client instance.
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

// In-memory cache for doctor specialties to reduce database calls.
const specialtyCache = {
    specialties: null as string[] | null,
    lastFetched: 0,
    ttl: 3600 * 1000 // Cache specialties for 1 hour
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
    if (error) {
        console.error("Error fetching specialties:", error);
        return [];
    }
    const uniqueSpecialties = [...new Set(data.map(doc => doc.specialty))];
    specialtyCache.specialties = uniqueSpecialties;
    specialtyCache.lastFetched = now;
    return uniqueSpecialties;
};

// Functions to get/save history from the 'conversations' table in Supabase.
async function getHistoryFromSupabase(sessionId: string): Promise<any[]> {
    const { data, error } = await supabase
        .from('conversations')
        .select('history')
        .eq('session_id', sessionId)
        .single();
    
    // PGRST116 means "not found", which is expected for a new conversation.
    if (error && error.code !== 'PGRST116') {
        console.error("Error fetching history:", error);
        return [];
    }
    return data?.history || [];
}

async function saveHistoryToSupabase(sessionId: string, history: any[]): Promise<void> {
    const { error } = await supabase
        .from('conversations')
        .upsert({ session_id: sessionId, history: history, last_updated: new Date().toISOString() });
    
    if (error) {
        console.error("Error saving history:", error);
    }
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
        const today = new Date(); // Use current server date
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const systemInstruction = `
        You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.
        **Primary Instruction: You MUST conduct the entire conversation in Telugu.**
        **List of Available Specialties:** [${specialtyListString}]
        **Internal Rules & Date Handling (CRITICAL):**
        - Today's date is ${getFormattedDate(today)}. Tomorrow's date is ${getFormattedDate(tomorrow)}.
        - You MUST silently convert natural language dates/times into 'YYYY-MM-DD' and 'HH:MM' formats before calling tools.
        **Workflow for New Appointments (Follow this order STRICTLY):**
        1.  **Understand Need:** Ask for symptoms or specialty in Telugu.
        2.  **Find & Present Real Doctors:** Use the 'getDoctorDetails' tool and present ONLY the real names returned. Do not hallucinate.
        3.  **Get User's Choice & Date:** After user picks a doctor, ask for their preferred date.
        4.  **Check Schedule (Multi-Step):** Use 'getAvailableSlots' first without 'timeOfDay' to get periods, then again with the user's preference to get specific times.
        5.  **Gather Final Details & Confirm:** Get patient's name and phone, then confirm all details in Telugu.
        6.  **Execute Booking (MANDATORY FINAL ACTION):** After the user's final "yes" or "ok", your ONLY action is to call the 'bookAppointment' tool. This is a terminal action; the appointment task is complete after this tool call.
        `;
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: systemInstruction,
            tools: [{
                // The placeholder is now filled with your actual tool definitions.
                functionDeclarations: [
                    { name: "getAvailableSlots", description: "Gets available time slots for a doctor. If 'timeOfDay' is not provided, it returns available periods (morning/afternoon/evening). If 'timeOfDay' IS provided, it returns specific times.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, date: { type: "STRING" }, timeOfDay: { type: "STRING", description: "Optional. Can be 'morning', 'afternoon', or 'evening'." } }, required: ["doctorName", "date"] } },
                    { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                    { name: "bookAppointment", description: "Books a medical appointment. This is the final step.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                    { name: "cancelAppointment", description: "Cancels an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] } },
                    { name: "rescheduleAppointment", description: "Reschedules an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" } }, required: ["doctorName", "patientName", "oldDate", "newDate", "newTime"] } },
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
            
            // Execute all tool calls in parallel and wait for all of them to complete.
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