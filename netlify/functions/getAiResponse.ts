// FILE: netlify/functions/getAiResponse.ts
// This version adds the new 'cancelAppointment' tool.

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

// Define common headers, including the CORS fix
const headers = {
  'Access-Control-Allow-Origin': '*', // Allows any origin to access this function
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const systemPrompt = `
You are Sahay, a friendly and efficient AI medical appointment assistant.
Your goal is to help users book, cancel, or find information about doctors using your tools.
- First, use 'getDoctorDetails' to find a doctor.
- After user confirmation, use 'bookAppointment' to schedule.
- If a user wants to cancel, you MUST use the 'cancelAppointment' tool.
- Extract the doctor's name, patient's name, and date from the conversation to use with your tools.
- After a successful action, confirm the details with the user.
- Do not provide medical advice.
`;

const handler: Handler = async (event: HandlerEvent) => {
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
                    {
                        name: "bookAppointment",
                        description: "Books a medical appointment in the hospital system.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                doctorName: { type: "STRING", description: "The full name of the doctor for the appointment." },
                                patientName: { type: "STRING", description: "The full name of the patient." },
                                date: { type: "STRING", description: "The date of the appointment in YYYY-MM-DD format." },
                                time: { type: "STRING", description: "The time of the appointment in HH:MM format (24-hour)." }
                            },
                            required: ["doctorName", "patientName", "date", "time"]
                        },
                    },
                    // --- NEW: Definition for the cancelAppointment tool ---
                    {
                        name: "cancelAppointment",
                        description: "Cancels an existing medical appointment in the hospital system.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                doctorName: { type: "STRING", description: "The full name of the doctor for the appointment being cancelled." },
                                patientName: { type: "STRING", description: "The full name of the patient whose appointment is being cancelled." },
                                date: { type: "STRING", description: "The date of the appointment to cancel in YYYY-MM-DD format." }
                            },
                            required: ["doctorName", "patientName", "date"]
                        },
                    },
                ],
            },
        }); 
        
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am Sahay, a medical appointment assistant. How can I assist?" }] },
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

            // --- UPDATED: Handle multiple tools ---
            if (call.name === 'getDoctorDetails') {
                toolUrl = `${event.headers.host}/.netlify/functions/getDoctorDetails`;
            } else if (call.name === 'bookAppointment') {
                toolUrl = `${event.headers.host}/.netlify/functions/bookAppointment`;
            } else if (call.name === 'cancelAppointment') {
                toolUrl = `${event.headers.host}/.netlify/functions/cancelAppointment`;
            }

            if (toolUrl) {
                const toolResponse = await fetch(`https://${toolUrl}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(call.args),
                });
                toolResult = await toolResponse.json();
            }

            const result2 = await chat.sendMessage([
                { functionResponse: { name: call.name, response: toolResult || { error: "Tool not found" } } }
            ]);
            const finalResponse = result2.response.text();
            return { statusCode: 200, headers, body: JSON.stringify({ reply: finalResponse }) };
        }

        const text = response.text();
        return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };

    } catch (error) {
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to process request." }) };
    }
};

export { handler };
