import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler } from '@netlify/functions';

// This is the main function for our AI brain
const handler: Handler = async (event) => {
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

    // Define the "menu" of tools we are giving to the AI
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
                // In the future, you would add more tools here like 'bookAppointment'
            ],
        },
    });

    // Start a chat session
    const chat = model.startChat();
    // Get the user's message from the request
    const { prompt } = JSON.parse(event.body || '{}');

    // Send the user's message to Gemini
    const result = await chat.sendMessage(prompt);
    const response = result.response;

    // The AI's response is now in the 'response' variable.
    // We can simply send its text content back to the frontend for now.
    const text = response.text();

    return {
        statusCode: 200,
        body: JSON.stringify({ reply: text }),
    };
};

export { handler };
