import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// FIX: Corrected typo from "hangetdler" to "handler"
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
    
    const currentDate = new Date().toLocaleDateIString('en-CA');

    // --- REFINED BILINGUAL SYSTEM PROMPT for better fluency ---
    const systemPrompt = `
    You are Sahay, a friendly AI medical assistant for Prudence Hospitals.

    **Your Core Task:** Your written responses, displayed in the chat, MUST be in clear, concise English. However, the system will speak your response aloud to the user in Telugu.

    **CRITICAL OUTPUT FORMAT:**
    You MUST format your final output as a single, valid JSON object with "english" and "telugu" keys.
    - "english": The message for the chat UI.
    - "telugu": The Telugu translation. **This must be highly fluent, conversational, and natural-sounding, as if a real person is speaking. Avoid overly formal or robotic language.**

    Example:
    {
      "english": "Of course. What day would you like to book the appointment for?",
      "telugu": "తప్పకుండా. మీరు ఏ రోజున అపాయింట్‌మెంట్ బుక్ చేసుకోవాలనుకుంటున్నారు?"
    }

    **Workflow:**
    1.  Ask for the user's need (symptoms, specialty) in English.
    2.  Use tools to find doctors or specialties.
    3.  Present options to the user in English.
    4.  Gather patient details (name, phone, date, time) in English.
    5.  Confirm all details before using the 'bookAppointment' tool.

    **Other Rules:**
    - If a tool fails, explain it gracefully in English.
    - You know the current date is ${currentDate}.
    - Do not give medical advice.
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
                { role: "model", parts: [{ text: JSON.stringify({ english: "Understood. I will provide my responses in JSON format with English for display and fluent Telugu for speech.", telugu: "అర్థమైంది. నేను నా సమాధానాలను ప్రదర్శన కోసం ఇంగ్లీష్‌లో మరియు స్పష్టమైన ప్రసంగం కోసం తెలుగులో JSON ఫార్మాట్‌లో అందిస్తాను."}) }] },
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
        
        const cleanedReply = finalReply.replace(/^```json\s*|```$/g, '').trim();

        try {
            const parsedReply = JSON.parse(cleanedReply);
            return { statusCode: 200, headers, body: JSON.stringify({ reply: parsedReply }) };
        } catch(e) {
            console.error("Failed to parse AI response as JSON, sending as fallback:", cleanedReply);
            const fallbackReply = { english: cleanedReply, telugu: "క్షమించండి, ఒక లోపం సంభవించింది." };
            return { statusCode: 200, headers, body: JSON.stringify({ reply: fallbackReply }) };
        }

    } catch (error: any) {
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        const errorReply = {
            english: "I'm sorry, I encountered a system error. Please try again.",
            telugu: "క్షమించండి, సిస్టమ్ లోపం ఎదురైంది. దయచేసి మళ్ళీ ప్రయత్నించండి."
        };
        return { statusCode: 500, headers, body: JSON.stringify({ reply: errorReply }) };
    }
};

export { handler };

