// FILE: netlify/functions/getAiResponse.ts
// This is a complete, robust, and corrected version of your AI handler.

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

// --- CONFIGURATION ---
// Centralized configuration for easier management.
const MODEL_NAME = "gemini-pro";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- INITIALIZATION & PRE-FLIGHT CHECKS ---
// Ensure all required environment variables are present before starting.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !GEMINI_API_KEY) {
    throw new Error("Missing required environment variables (Supabase URL/Key or Gemini API Key).");
}

// Initialize Supabase and Gemini clients once.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- CORS HEADERS ---
const headers = {
    'Access-Control-Allow-Origin': '*', // Allow requests from any origin
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

// --- DATABASE HELPER FUNCTIONS ---

// In-memory cache for doctor specialties to reduce database calls.
const specialtyCache = {
    specialties: null as string[] | null,
    lastFetched: 0,
    ttl: 3600 * 1000 // Cache for 1 hour
};

/**
 * Fetches the list of unique doctor specialties from the database, with caching.
 */
async function getSpecialties(): Promise<string[]> {
    const now = Date.now();
    if (specialtyCache.specialties && (now - specialtyCache.lastFetched < specialtyCache.ttl)) {
        return specialtyCache.specialties;
    }
    console.log("Fetching specialties from database...");
    const { data, error } = await supabase.from('doctors').select('specialty');
    if (error) {
        console.error("Error fetching specialties:", error);
        return [];
    }
    const uniqueSpecialties = [...new Set((data || []).map(doc => doc.specialty))];
    specialtyCache.specialties = uniqueSpecialties;
    specialtyCache.lastFetched = now;
    return uniqueSpecialties;
};

/**
 * Retrieves the conversation history for a given session ID.
 */
async function getHistoryFromSupabase(sessionId: string): Promise<any[]> {
    const { data, error } = await supabase.from('conversations').select('history').eq('session_id', sessionId).single();
    // A "PGRST116" error is normal if no history exists yet, so we ignore it.
    if (error && error.code !== 'PGRST116') {
        console.error("Error fetching history:", error);
        return [];
    }
    return data?.history || [];
}

/**
 * Saves or updates the conversation history for a given session ID.
 */
async function saveHistoryToSupabase(sessionId: string, history: any[]): Promise<void> {
    const { error } = await supabase.from('conversations').upsert({
        session_id: sessionId,
        history: history,
        last_updated: new Date().toISOString()
    });
    if (error) {
        console.error("Error saving history:", error);
    }
}

// --- MAIN NETLIFY HANDLER ---

export const handler: Handler = async (event: HandlerEvent) => {
    // Handle CORS preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    try {
        const { sessionId, userMessage } = JSON.parse(event.body || '{}');
        if (!sessionId || !userMessage) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "sessionId and userMessage are required." }) };
        }

        const specialtyListString = (await getSpecialties()).join(', ');
        const today = new Date();
        const getFormattedDate = (date: Date): string => date.toISOString().split('T')[0];

        // --- SYSTEM INSTRUCTION (The AI's Core Rules) ---
        const systemInstruction = `You are Sahay, a friendly AI medical appointment assistant for Prudence Hospitals in Hyderabad. Your entire response MUST be ONLY in Telugu script. You are STRICTLY FORBIDDEN from including English translations. Today's date is ${getFormattedDate(today)}. Available specialties are: [${specialtyListString}]. Follow your workflows strictly.`; // A concise version of your detailed prompt. You can paste your full prompt here.

        // --- MODEL CONFIGURATION ---
        const model = genAI.getGenerativeModel({
            model: MODEL_NAME,
            // Safety settings to reduce the chance of the model refusing to answer.
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
            // Define the tools (functions) the AI can use.
            tools: [{
                functionDeclarations: [
                    // Paste your full function declarations here
                    { name: "getDoctorDetails", description: "Finds doctors by specialty.", parameters: { type: "OBJECT", properties: { specialty: { type: "STRING" } }, required: ["specialty"] } },
                    { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                    // ... include all your other tools (cancel, reschedule, etc.)
                ]
            }],
        });
        
        const history = await getHistoryFromSupabase(sessionId);

        // --- CORRECTED SDK USAGE ---
        // Start the chat session, providing the system instruction here.
        const chat = model.startChat({
            history,
            systemInstruction: { role: "system", parts: [{ text: systemInstruction }] }
        });

        const result = await chat.sendMessage(userMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        // If the AI decides to use a tool...
        if (functionCalls && functionCalls.length > 0) {
            const host = event.headers.host || 'sahayhealth.netlify.app';
            
            const toolPromises = functionCalls.map(call => {
                console.log(`AI is calling tool: ${call.name} with args:`, call.args);
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
            // Send the tool results back to the AI to get a final text response.
            const finalResult = await chat.sendMessage(JSON.stringify(toolResponses));
            await saveHistoryToSupabase(sessionId, await chat.getHistory());
            
            return { statusCode: 200, headers, body: JSON.stringify({ reply: finalResult.response.text() }) };
        }

        // If the AI just wants to chat...
        await saveHistoryToSupabase(sessionId, await chat.getHistory());
        return { statusCode: 200, headers, body: JSON.stringify({ reply: response.text() }) };

    } catch (error: any) {
        console.error("FATAL: Uncaught error in getAiResponse handler.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "An unexpected error occurred." }) };
    }
};