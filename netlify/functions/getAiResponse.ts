import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

// Define common headers, including the CORS fix
const headers = {
  'Access-Control-Allow-Origin': '*', // Allows any origin to access this function
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// --- UPDATED: System Prompt ---
// This prompt now guides the AI to use tools first.
const systemPrompt = `
You are Elliot, a friendly and efficient AI medical appointment assistant for a hospital group.
Your primary goal is to help users book, reschedule, or find information about doctors using the tools you have available.
- Be polite, empathetic, and professional.
- **Your first step should always be to use the 'getDoctorDetails' tool based on the user's request (e.g., if they mention a specialty).**
- Only after you have the results from the tool should you respond to the user.
- If the tool returns a list of doctors, present them to the user.
- If the tool returns no doctors, inform the user that you couldn't find any doctors with that specialty and ask if they'd like to search for another.
- Do not ask for location, insurance, or other personal details unless a tool specifically requires it.
- Do not provide any medical advice. If asked for medical advice, you must politely decline and recommend they book an appointment with a doctor.
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
        
        // --- UPDATED: Re-enabling the tool definition ---
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
                ],
            },
        }); 
        
        console.log("Step 4: Initialized Gemini model with tools. Sending prompt to AI...");
        
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am Elliot, a medical appointment assistant. I will use my tools to help you. How can I assist?" }] }
            ]
        });

        const result = await chat.sendMessage(prompt);
        const response = result.response;
        
        // --- NOTE: We are not handling the actual tool call yet ---
        // For now, we are just sending the AI's text response back.
        // The next step will be to handle the function call if the AI requests it.
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
