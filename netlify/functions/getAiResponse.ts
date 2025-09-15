import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

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
    
    const currentDate = new Date().toLocaleDateString('en-CA');

    // --- REVISED BILINGUAL SYSTEM PROMPT ---
    const systemPrompt = `
    You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

    **Your Core Task:** You will communicate with the user via a chat interface. Your written responses, which will be displayed in the chat, MUST be in clear, concise English. However, the system will speak your response aloud to the user in Telugu.

    **CRITICAL OUTPUT FORMAT:**
    You MUST format your final output as a single, valid JSON object with two keys: "english" and "telugu".
    - The "english" key will contain the message to be displayed in the chat UI.
    - The "telugu" key will contain the exact Telugu translation of the English message, which will be used for text-to-speech.

    Example Response Format:
    {
      "english": "Hello! I am Sahay, your AI assistant. How can I help you today?",
      "telugu": "నమస్కారం! నేను సహాయ్, మీ AI అసిస్టెంట్. నేను మీకు ఎలా సహాయపడగలను?"
    }

    **Workflow for New Appointments:**
    1.  **Understand the User's Need:** Ask for their symptoms or the specialty they are looking for (in English).
    2.  **Symptom Analysis:** Determine the most appropriate specialty based on symptoms.
    3.  **Confirm Specialty:** Use the 'getDoctorDetails' tool to find doctors.
    4.  **Present Options & Get Confirmation:** Present the doctor's full names to the user in English.
    5.  **Gather Information:** Gather the patient's name, phone number, and desired date/time in English.
    6.  **Final Confirmation:** Before booking, confirm all details with the user in English.
    7.  **Execute Booking:** Call the 'bookAppointment' tool.

    **Other Rules:**
    - If a tool fails, explain the issue gracefully in English.
    - You are aware that the current date is ${currentDate}.
    - Do not provide medical advice.
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
                { role: "model", parts: [{ text: JSON.stringify({ english: "Understood. I will provide my responses in JSON format with English for display and Telugu for speech.", telugu: "అర్థమైంది. నేను నా సమాధానాలను ప్రదర్శన కోసం ఇంగ్లీష్‌లో మరియు ప్రసంగం కోసం తెలుగులో JSON ఫార్మాట్‌లో అందిస్తాను."}) }] },
                ...history.slice(0, -1)
            ]
        });

        const latestUserMessage = history[history.length - 1].parts[0].text;
        const result = await chat.sendMessage(latestUserMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        let finalReply;

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            const host = event.headers.host || 'sahayhealth.netlify.app';
            const toolUrl = `https://${host}/.netlify/functions/${call.name}`;
            
            const toolResponse = await fetch(toolUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(call.args),
            });
            const toolResult = await toolResponse.json();

            const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }]);
            finalReply = result2.response.text();
        } else {
            finalReply = response.text();
        }

        try {
            const parsedReply = JSON.parse(finalReply);
            return { statusCode: 200, headers, body: JSON.stringify({ reply: parsedReply }) };
        } catch(e) {
            console.error("Failed to parse AI response as JSON, sending as fallback:", finalReply);
            const fallbackReply = { english: finalReply, telugu: finalReply }; // Fallback if AI fails to return JSON
            return { statusCode: 200, headers, body: JSON.stringify({ reply: fallbackReply }) };
        }

    } catch (error: any) {
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || "Failed to process request." }) };
    }
};

export { handler };
