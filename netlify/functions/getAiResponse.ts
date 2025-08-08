// FILE: netlify/functions/getAiResponse.ts
// This version includes dynamic date generation and robust error handling for tool calls.

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

// Define common headers that will be sent with every response.
const headers = {
  'Access-Control-Allow-Origin': '*', // Allows any website to access this function
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
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
    
    const { history } = body;
    if (!history || !Array.isArray(history) || history.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No history provided." }) };
    }
    
    // --- FIX 1: Dynamically generate the current date ---
    const currentDate = new Date().toLocaleDateString('en-CA'); // Gets date in YYYY-MM-DD format

    const systemPrompt = `
    You are Sahay, a friendly and efficient AI medical appointment assistant for Prudence Hospitals.
    Your primary goal is to help users book, cancel, or reschedule appointments using your tools.
    - You are aware that the current date is ${currentDate}.
    - Be flexible with date and time formats. A user might say "next Friday" or "tomorrow at 5pm". You must interpret this and convert it to the required YYYY-MM-DD and HH:MM format for your tools.
    - Do not repeatedly ask for a specific format. Instead, ask clarifying questions if you are unsure. For example, if a user says "the 15th," ask "Which month for the 15th?".
    - Gather all necessary information (like patient name, doctor specialty, date, and time) through conversation before calling a tool.
    - After a successful action, confirm the details with the user.
    - Do not provide medical advice.
    `;

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{
                functionDeclarations: [
                    {
                        name: "getDoctorDetails",
                        description: "Get a list of available doctors and their specialties.",
                        parameters: { type: "OBJECT", properties: { specialty: { type: "STRING" } } },
                    },
                    {
                        name: "bookAppointment",
                        description: "Books a medical appointment.",
                        parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "date", "time"] },
                    },
                    {
                        name: "cancelAppointment",
                        description: "Cancels an existing medical appointment.",
                        parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] },
                    },
                    {
                        name: "rescheduleAppointment",
                        description: "Reschedules an existing medical appointment to a new date and time.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                doctorName: { type: "STRING" }, patientName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" }
                            },
                            required: ["doctorName", "patientName", "oldDate", "newDate", "newTime"]
                        },
                    },
                ],
            }],
        }); 
        
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am Sahay, an AI assistant for Prudence Hospitals. How can I assist?" }] },
                ...history.slice(0, -1)
            ]
        });

        const latestUserMessage = history[history.length - 1].parts[0].text;

        const result = await chat.sendMessage(latestUserMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            let toolResult;
            let toolUrl;

            // Route to the correct tool based on the function call name
            if (call.name === 'getDoctorDetails') {
                toolUrl = `${event.headers.host}/.netlify/functions/getDoctorDetails`;
            } else if (call.name === 'bookAppointment') {
                toolUrl = `${event.headers.host}/.netlify/functions/bookAppointment`;
            } else if (call.name === 'cancelAppointment') {
                toolUrl = `${event.headers.host}/.netlify/functions/cancelAppointment`;
            } else if (call.name === 'rescheduleAppointment') {
                toolUrl = `${event.headers.host}/.netlify/functions/rescheduleAppointment`;
            }

            if (toolUrl) {
                const toolResponse = await fetch(`https://${toolUrl}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(call.args),
                });

                // --- FIX 2: Better error handling for the tool call ---
                if (!toolResponse.ok) {
                    // The tool call failed.
                    const errorBody = await toolResponse.text();
                    console.error(`Tool call to ${call.name} failed with status ${toolResponse.status}: ${errorBody}`);
                    toolResult = { 
                        error: `Tool execution failed with status: ${toolResponse.status}`, 
                        details: errorBody 
                    };
                } else {
                    // The tool call was successful.
                    toolResult = await toolResponse.json();
                }
            } else {
                toolResult = { error: "Tool not found" };
            }

            // Send the tool's result back to the AI
            const result2 = await chat.sendMessage([
                { functionResponse: { name: call.name, response: toolResult } }
            ]);
            const finalResponse = result2.response.text();
            return { statusCode: 200, headers, body: JSON.stringify({ reply: finalResponse }) };
        }

        // If no tool was called, just return the AI's text response
        const text = response.text();
        return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };

    } catch (error) {
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to process request." }) };
    }
};

export { handler };
