// FILE: netlify/functions/getAiResponse.ts
// This version adds the new 'bookAppointment' tool.

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
- First, use the 'getDoctorDetails' tool to find a doctor.
- After the user confirms which doctor they want, you MUST use the 'bookAppointment' tool to schedule the appointment in the system.
- Extract the doctor's name, date, and time from the conversation to use with the 'bookAppointment' tool.
- After successfully booking, confirm the appointment details with the user.
- Do not provide any medical advice.
`;

const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- Full AI function started ---");

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
                    // --- NEW: Definition for the bookAppointment tool ---
                    {
                        name: "bookAppointment",
                        description: "Books a medical appointment in the hospital system.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                doctorName: {
                                    type: "STRING",
                                    description: "The full name of the doctor for the appointment."
                                },
                                patientName: {
                                    type: "STRING",
                                    description: "The full name of the patient."
                                },
                                date: {
                                    type: "STRING",
                                    description: "The date of the appointment in YYYY-MM-DD format."
                                },
                                time: {
                                    type: "STRING",
                                    description: "The time of the appointment in HH:MM format (24-hour)."
                                }
                            },
                            required: ["doctorName", "patientName", "date", "time"]
                        },
                    },
                ],
            },
        }); 
        
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am Elliot, a medical appointment assistant. I will use my tools to help you. How can I assist?" }] },
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

            // --- UPDATED: Handle multiple tools ---
            if (call.name === 'getDoctorDetails') {
                const toolUrl = `${event.headers.host}/.netlify/functions/getDoctorDetails`;
                const toolResponse = await fetch(`https://${toolUrl}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(call.args),
                });
                toolResult = await toolResponse.json();
            } else if (call.name === 'bookAppointment') {
                // Call the new bookAppointment function
                const toolUrl = `${event.headers.host}/.netlify/functions/bookAppointment`;
                const toolResponse = await fetch(`https://${toolUrl}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(call.args),
                });
                toolResult = await toolResponse.json();
            }

            const result2 = await chat.sendMessage([
                { functionResponse: { name: call.name, response: toolResult } }
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
