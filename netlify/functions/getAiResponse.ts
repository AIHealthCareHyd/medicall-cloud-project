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
- Your first step should always be to use the 'getDoctorDetails' tool based on the user's request (e.g., if they mention a specialty).
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
        return { statusCode: 500, headers, body: JSON.stringify({ error: "AI configuration error." }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }

    const { prompt } = body;
    if (!prompt) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No prompt provided." }) };
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
                ],
            },
        }); 
        
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am Elliot, a medical appointment assistant. I will use my tools to help you. How can I assist?" }] }
            ]
        });

        const result = await chat.sendMessage(prompt);
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            console.log("AI wants to call a tool:", functionCalls[0]);
            const call = functionCalls[0];

            if (call.name === 'getDoctorDetails') {
                // The AI wants to find doctors. Let's call our other function.
                const toolUrl = `${event.headers.host}/.netlify/functions/getDoctorDetails`;
                
                const toolResponse = await fetch(`https://${toolUrl}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(call.args),
                });

                const toolResult = await toolResponse.json();

                // Send the tool's result back to the AI
                const result2 = await chat.sendMessage([
                    {
                        functionResponse: {
                            name: 'getDoctorDetails',
                            response: toolResult,
                        },
                    },
                ]);
                
                // Get the AI's final text response and send it to the user
                const finalResponse = result2.response.text();
                console.log("Final AI response after tool call:", finalResponse);
                return { statusCode: 200, headers, body: JSON.stringify({ reply: finalResponse }) };
            }
        }

        // If no tool call, just return the text
        const text = response.text();
        console.log("Simple AI response (no tool call):", text);
        return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };

    } catch (error) {
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to process request." }) };
    }
};

export { handler };