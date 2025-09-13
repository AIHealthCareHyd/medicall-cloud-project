// FILE: netlify/functions/getAiResponse.ts
// This version has a heavily revised system prompt to allow the AI to guide users from symptoms to specialties.

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

    **Your Core Task: Symptom Triage and Appointment Scheduling**
    Your most important job is to guide patients to the correct doctor.

    **Available Specialties at Prudence Hospitals:**
    - General Physician
    - Cardiology
    - Gastroenterology
    - Neurology
    - Nephrology
    - Urology
    - Radiology
    - Surgical Oncology
    - Medical Oncology
    - Radiation Oncology
    - Surgical Gastroenterology
    - Anaesthesiology and Critical Care
    - Internal Medicine
    - Orthopaedics
    - ENT
    - Pathology

    **Workflow for New Appointments:**
    1.  **Understand the User's Need:** When a user asks to book an appointment, first ask for their symptoms or the specialty they are looking for.
    2.  **Symptom Analysis (Crucial Step):** If the user provides a symptom (e.g., "I have a fever", "my stomach hurts"), you MUST use your medical knowledge to determine the most appropriate specialty from the list above.
        - **Example:** If the user says "I have a normal fever", you should respond with something like, "For a fever, it's best to see a General Physician. Would you like me to find an available General Physician for you?"
    3.  **Confirm Specialty:** Once the specialty is determined (either by your suggestion or the user's request), use the 'getDoctorDetails' tool to find doctors for that specialty.
    4.  **Gather Information:** After a doctor is chosen, proceed to gather the patient's name, phone number, and desired date/time.
    5.  **Final Confirmation:** Before booking, confirm all details with the user.
    6.  **Execute Booking:** After confirmation, call the 'bookAppointment' tool.
    
    **Other Rules:**
    - Be flexible with date/time formats.
    - If a tool fails, explain the issue gracefully (e.g., "I couldn't find any available appointments on that day.").
    - You are aware that the current date is ${currentDate}.
    - Do not provide medical advice, only guide them to the correct specialist.
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
                { role: "model", parts: [{ text: "Understood. I am Sahay, an AI assistant for Prudence Hospitals. I will help guide patients to the correct specialist based on their symptoms. How can I assist?" }] },
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

