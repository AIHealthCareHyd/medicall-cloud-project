// FILE: netlify/functions/getAiResponse.ts
// This version has a heavily revised system prompt to fix the booking and cancellation conversational flows.

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

    // --- REVISED SYSTEM PROMPT ---
    const systemPrompt = `
    You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

    **Most Important Rule:** Your primary job is to understand natural language. When a user gives you a date or time like "August 15th 2025", "next Tuesday at 5pm", or "10/10/25", you MUST interpret it and convert it to the required 'YYYY-MM-DD' and 'HH:MM' format for your tools. **NEVER repeatedly ask the user for a specific format.** If you are unsure, ask a single clarifying question (e.g., "Which month did you mean for the 15th?").

    **Booking Process Directive:**
    1.  First, ask for the desired specialty or doctor. Use 'getDoctorDetails' to verify and list available doctors.
    2.  Once a doctor is selected, ask for the patient's full name and 10-digit phone number.
    3.  Then, ask for the desired date and time.
    4.  **Final Confirmation:** Before taking any action, you MUST repeat all the gathered details (Patient Name, Phone, Doctor Name, Date, Time) back to the user and ask for confirmation.
    5.  **Execute Booking:** ONLY after the user confirms, you must call the 'bookAppointment' tool with the complete, confirmed information. You MUST remember all details through the confirmation step.

    **Cancellation Process Directive:**
    1. If the user asks to cancel an appointment, first check the conversation history to see if you just booked one for them. If so, use those details.
    2. If not, ask for the patient's name, the doctor's name, and the appointment date.
    3. Call the 'cancelAppointment' tool.
    4. **Handle the Tool's Response:**
        - If the tool returns 'success: true', you must inform the user the cancellation was successful.
        - If the tool returns 'success: false' with a message like 'Could not find a confirmed appointment', you MUST inform the user of this gracefully. Say something like: "I couldn't find a confirmed appointment with those details. It might have already been cancelled or the details might be incorrect." DO NOT ask for the same information again.

    **Other Critical Rules:**
    - You are aware that the current date is ${currentDate}.
    - Do not provide medical advice.
    - Always use the conversation history to remember details the user has already provided.
    `;

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{
                functionDeclarations: [
                    { name: "getAllSpecialties", description: "Gets a list of all unique medical specialties available at the hospital.", parameters: { type: "OBJECT", properties: {} } },
                    { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                    { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                    { name: "cancelAppointment", description: "Cancels an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] } },
                    { name: "rescheduleAppointment", description: "Reschedules an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" } }, required: ["doctorName", "patientName", "oldDate", "newDate", "newTime"] } },
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
            const host = event.headers.host || 'sahayhealth.netlify.app';
            const toolUrl = `https://${host}/.netlify/functions/${call.name}`;
            
            const toolResponse = await fetch(toolUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(call.args),
            });
            toolResult = await toolResponse.json();

            const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }]);
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

