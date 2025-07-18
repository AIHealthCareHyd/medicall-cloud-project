import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- getAiResponse function started ---");

    if (!process.env.GEMINI_API_KEY) {
        console.error("FATAL: Gemini API key is not set.");
        return { statusCode: 500, body: JSON.stringify({ error: "AI configuration error." }) };
    }
    console.log("Step 1: Gemini API key found.");

    let body;
    try {
        // The request data is in the 'event.body' property
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        console.error("FATAL: Could not parse request body.", e);
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
    }
    console.log("Step 2: Successfully parsed request body.");

    const { prompt } = body;
    if (!prompt) {
        console.error("FATAL: No prompt found in request body.");
        return { statusCode: 400, body: JSON.stringify({ error: "No prompt provided." }) };
    }
    console.log(`Step 3: Received prompt: "${prompt}"`);

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 
        
        console.log("Step 4: Initialized Gemini model. Sending prompt to AI...");
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();
        
        console.log(`Step 5: Received response from AI: "${text}"`);

        return {
            statusCode: 200,
            body: JSON.stringify({ reply: text }),
        };
    } catch (error) {
        console.error("FATAL: Error during Gemini API call.", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Failed to get response from AI." }) };
    }
};

export { handler };
