// FILE: netlify/functions/getAiResponse.ts
// V3: Adds strict anti-hallucination rules and improved contextual memory.

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
    
    const currentDate = new Date().toLocaleDateString('en-CA'); // Gets date in YYYY-MM-DD format

    // --- UPDATED SYSTEM PROMPT WITH STRICTER RULES ---
    const systemPrompt = `
    You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

    **Core booking workflow:**
    1.  When a user wants to book an appointment and provides a specialty (e.g., "radiology"), your FIRST step is to use the 'getDoctorDetails' tool with the specialty and desired date to find available doctors.
    2.  Present the list of available doctor names to the user.
    3.  Once the user chooses a doctor, you will have the exact 'doctorName'.
    4.  Only then should you call the 'bookAppointment' tool with the patient's name, the chosen doctor's name, date, and time.

    **Critical Rules for Accuracy:**
    - **No Hallucinations:** If a tool returns no results or an error, you MUST state that you could not find the information. DO NOT invent information or suggest alternatives that were not provided by the tool. For example, if you can't find an appointment for 'Ashwini', you must not suggest one exists for 'Rashmi'.
    - **Contextual Memory:** Pay close attention to the immediate conversation history. If you have just identified a full doctor or patient name from a tool, you MUST use that exact information in subsequent steps. Do not get confused by partial names in the next user turn.
    - **Fuzzy Name Resolution:** If a user provides a partial doctor's name (e.g., "Dr. Murthy" or "Dr. Murti"), your first step is to use the 'getDoctorDetails' tool to find the full, correct name. Confirm the correct doctor with the user before proceeding with any action like booking or cancellation.

    **Other Instructions:**
    - You are aware that the current date is ${currentDate}.
    - After any successful action, confirm the final details with the user.
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
                        description: "Use this to find the full name of a doctor from a partial name, or to get a list of doctors. Can filter by specialty and date.",
                        parameters: { 
                            type: "OBJECT", 
                            properties: { 
                                doctorName: { type: "STRING", description: "A partial or full name of the doctor to search for."},
                                specialty: { type: "STRING", description: "The medical specialty to search for (e.g., 'Radiology')." },
                                date: { type: "STRING", description: "The date to check for availability (YYYY-MM-DD)." } 
                            } 
                        },
                    },
                    {
                        name: "bookAppointment",
                        description: "Books a medical appointment once a specific doctor has been identified.",
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

                if (!toolResponse.ok) {
                    const errorBody = await toolResponse.text();
                    console.error(`Tool call to ${call.name} failed with status ${toolResponse.status}: ${errorBody}`);
                    toolResult = { 
                        error: `Tool execution failed with status: ${toolResponse.status}`, 
                        details: errorBody 
                    };
                } else {
                    toolResult = await toolResponse.json();
                }
            } else {
                toolResult = { error: "Tool not found" };
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
