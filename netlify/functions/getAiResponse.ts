// FILE: netlify/functions/getAiResponse.ts
// V9: Implements robust date interpretation and a two-step process for fuzzy name resolution.

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

    // --- UPDATED SYSTEM PROMPT WITH FINAL LOGIC FIXES ---
    const systemPrompt = `
    You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

    Most Important Rule: Your primary job is to understand natural language. When a user gives you a date or time like "October 10th 2025", "next Tuesday at 5pm", or "10/10/25", you MUST interpret it and convert it to the required 'YYYY-MM-DD' or 'HH:MM' format before using any tool. NEVER repeatedly ask the user for a specific format.

    Primary Directive: Follow this procedure step-by-step.

    0.  Pre-check Specialty: When a user asks to book an appointment with a specialty (e.g., "Cardiology"), your VERY FIRST action is to use the 'getDoctorDetails' tool with that specialty.
        - If the tool returns an empty list, you MUST immediately inform the user that this specialty is not available and stop the booking process.
        - If the tool returns doctors, then and ONLY then should you proceed to ask for the date and other information.

    1.  Analyze the User's Request:
        - If the user asks for a list of all available specialties, use the 'getAllSpecialties' tool.
        - If the user asks to list all doctors, use 'getDoctorDetails' without any parameters.
        - For booking, if the specialty is valid, determine if the user provided a specific date.
            - NO: Present the list of doctors and their next available dates to help the user choose.
            - YES: Interpret the user's date, then use 'getDoctorDetails' with BOTH 'specialty' and the formatted 'date' to find available doctors.
    
    2.  Confirm Doctor with User: After using 'getDoctorDetails', present the list of available doctors to the user. Once the user chooses one, you have the exact 'doctorName'.

    3.  Execute Final Action:
        - For booking, now that you have all the details, call the 'bookAppointment' tool.
        - For cancellation, you must follow the Fuzzy Name Resolution rule first, then interpret the user's date, and finally proceed with the 'cancelAppointment' tool.
        - For rescheduling, you must follow the Fuzzy Name Resolution rule first, then interpret the user's date, and finally proceed with the 'rescheduleAppointment' tool.
        
    Critical Rules for Accuracy:
    - No Hallucinations: If a tool returns no results, state that you could not find the information. DO NOT invent information.
    - Contextual Memory: If you have just identified a full doctor or patient name, use that exact information in subsequent steps.
    - Fuzzy Name Resolution: If a user provides a partial doctor's name for an action (e.g., "cancel appointment with Dr. Subbarao"), your first step MUST be to use the 'getDoctorDetails' tool with the partial 'doctorName' to find the full, correct name. Only after you have the exact full name should you call the 'cancelAppointment' or 'bookAppointment' tool.

    Other Instructions:
    - You are aware that the current date is ${currentDate}.
    - Do not provide medical advice.
    `;

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{
                functionDeclarations: [
                    {
                        name: "getAllSpecialties",
                        description: "Gets a list of all medical specialties available at the hospital.",
                        parameters: { type: "OBJECT", properties: {} },
                    },
                    {
                        name: "getDoctorDetails",
                        description: "Finds doctors. Use with only 'specialty' for general availability or to validate a specialty. Use with 'specialty' and 'date' for a specific day. Use with 'doctorName' to resolve partial names. Use with no parameters to list all doctors.",
                        parameters: { 
                            type: "OBJECT", 
                            properties: { 
                                doctorName: { type: "STRING", description: "A partial or full name of the doctor to search for."},
                                specialty: { type: "STRING", description: "The medical specialty to search for (e.g., 'Radiology')." },
                                date: { type: "STRING", description: "Optional. The date to check for availability (YYYY-MM-DD)." } 
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

            if (call.name === 'getAllSpecialties') {
                toolUrl = `${event.headers.host}/.netlify/functions/getAllSpecialties`;
            } else if (call.name === 'getDoctorDetails') {
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
