// FILE: netlify/functions/getAiResponse.ts
// This version correctly uses the conversation history sent from the frontend.

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

// Define common headers, including the CORS fix
const headers = {
  'Access-Control-Allow-Origin': '*', // Allows any origin to access this function
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const systemPrompt = `
You are Elliot, a friendly and efficient AI medical appointment assistant for a hospital group.
Your primary goal is to help users book, reschedule, or find information about doctors using the tools you have available.
- Be polite, empathetic, and professional.
- Your first step should always be to use the 'getDoctorDetails' tool based on the user's request (e.g., if they mention a specialty).
- Only after you have the results from the tool should you respond to the user.
- If the tool returns a list of doctors, present them to the user.
- If the tool returns no doctors, inform the user that you couldn't find any doctors with that specialty and ask if they'd like to search for another.
- Do not ask for location, insurance, or other personal details unless a tool specifically requires it.
- Do not provide any medical advice. If asked for medical advice, you must politely decline and recommend they book an appointment with a doctor.
`;

const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- getAiResponse function started ---");

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    if (!process.env.GEMINI_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "AI configuration error." }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }

    // --- UPDATED: Get the history from the request body ---
    const { history } = body;
    if (!history || !Array.isArray(history) || history.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No history provided." }) };
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: {
                functionDeclarations: [
                    {
                        name: "getDoctorDetails",
                        description: "Get a list of available doctors and their specialties from the hospital database.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                specialty: {
                                    type: "STRING",
                                    description: "The medical specialty to search for, e.g., 'Cardiologist', 'Dermatologist'."
                                }
                            },
                        },
                    },
                ],
            },
        }); 
        
        // --- UPDATED: Start the chat with the full conversation history ---
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am Elliot, a medical appointment assistant. How can I assist?" }] },
                // Spread the rest of the conversation history
                ...history.slice(0, -1) // Send all but the most recent user message
            ]
        });

        // Get the latest user message to send
        const latestUserMessage = history[history.length - 1].parts[0].text;

        const result = await chat.sendMessage(latestUserMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            if (call.name === 'getDoctorDetails') {
                const toolUrl = `${event.headers.host}/.netlify/functions/getDoctorDetails`;
                const toolResponse = await fetch(`https://${toolUrl}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(call.args),
                });
                const toolResult = await toolResponse.json();
                const result2 = await chat.sendMessage([
                    { functionResponse: { name: 'getDoctorDetails', response: toolResult } }
                ]);
                const finalResponse = result2.response.text();
                return { statusCode: 200, headers, body: JSON.stringify({ reply: finalResponse }) };
            }
        }

        const text = response.text();
        return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };

    } catch (error) {
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to process request." }) };
    }
};

export { handler };
