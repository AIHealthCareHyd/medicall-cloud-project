import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

// Define common headers, including the CORS fix
const headers = {
  'Access-Control-Allow-Origin': '*', // Allows any origin to access this function
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// --- NEW: System Prompt ---
// This prompt gives the AI its persona and instructions.
const systemPrompt = `
You are Elliot, a friendly and efficient AI medical appointment assistant for a hospital group.
Your primary goal is to help users book, reschedule, or find information about doctors.
- Be polite, empathetic, and professional.
- Keep your responses concise and to the point.
- Do not provide any medical advice. If asked for medical advice, you must politely decline and recommend they book an appointment with a doctor.
- Your knowledge is limited to the tools you have access to.
`;

const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- getAiResponse function started ---");

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    if (!process.env.GEMINI_API_KEY) {
        console.error("FATAL: Gemini API key is not set.");
        return { statusCode: 500, headers, body: JSON.stringify({ error: "AI configuration error." }) };
    }
    console.log("Step 1: Gemini API key found.");

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        console.error("FATAL: Could not parse request body.", e);
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }
    console.log("Step 2: Successfully parsed request body.");

    const { prompt } = body;
    if (!prompt) {
        console.error("FATAL: No prompt found in request body.");
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No prompt provided." }) };
    }
    console.log(`Step 3: Received prompt: "${prompt}"`);

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 
        
        console.log("Step 4: Initialized Gemini model. Sending prompt to AI...");
        
        // --- UPDATED: Sending a structured prompt with history ---
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am Elliot, a medical appointment assistant. How can I help?" }] }
            ]
        });

        const result = await chat.sendMessage(prompt);
        const response = result.response;
        const text = response.text();
        
        console.log(`Step 5: Received response from AI: "${text}"`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ reply: text }),
        };
    } catch (error) {
        console.error("FATAL: Error during Gemini API call.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to get response from AI." }) };
    }
};

export { handler };
