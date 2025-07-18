import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler } from '@netlify/functions';

// This is the main function for our AI brain
const handler: Handler = async (event) => { // The data is in the 'event' object
    // Check for the Gemini API Key
    if (!process.env.GEMINI_API_KEY) {
        console.error("Gemini API key is not set.");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "AI configuration error." }),
        };
    }

    // Initialize the Gemini client with our secret key
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

    const chat = model.startChat();
    
    // *** THIS IS THE CORRECTED LINE ***
    // We get the 'prompt' from the 'event.body'
    const { prompt } = JSON.parse(event.body || '{}');

    const result = await chat.sendMessage(prompt);
    const response = result.response;
    const text = response.text();

    return {
        statusCode: 200,
        body: JSON.stringify({ reply: text }),
    };
};

export { handler };