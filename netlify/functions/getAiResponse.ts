// FILE: netlify/functions/getAiResponse.ts
// V9: Implements robust date interpretation and a two-step process for fuzzy name resolution.

// This line imports the main Google Generative AI library, which gives us access to the Gemini model.
import { GoogleGenerativeAI } from '@google/generative-ai';
// This line imports the standard rulebooks for how a Netlify function should work.
import type { Handler, HandlerEvent } from '@netlify/functions';

// Define common headers that will be sent with every response for security (CORS).
const headers = {
  'Access-Control-Allow-Origin': '*', // Allows any website to access this function
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// This is the main handler function that runs when we get a request from the chat interface.
const handler: Handler = async (event: HandlerEvent) => {
    // A standard check for CORS preflight requests.
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    // A critical check to ensure our API key for the Gemini AI model is available. Without it, the AI won't work.
    if (!process.env.GEMINI_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "AI configuration error." }) };
    }
    // This variable will hold the conversation history from the user.
    let body;
    try {
        // We parse the incoming request to get the conversation data.
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }
    
    // We extract the conversation history from the request.
    const { history } = body;
    // We check if the history is valid. If not, we can't proceed.
    if (!history || !Array.isArray(history) || history.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No history provided." }) };
    }
    
    // The AI needs to know today's date to understand phrases like "tomorrow" or "next Tuesday".
    const currentDate = new Date().toLocaleDateString('en-CA'); // Gets date in YYYY-MM-DD format

    // --- UPDATED SYSTEM PROMPT WITH FINAL LOGIC FIXES ---
    // This is the most important part of the file. The system prompt is the AI's "constitution" or "instruction manual".
    // It defines its personality, its rules, and its step-by-step procedures. This keeps the AI focused and accurate.
    const systemPrompt = `
    You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

    Most Important Rule: Your primary job is to understand natural language. When a user gives you a date or time like "October 10th 2025", "next Tuesday at 5pm", or "10/10/25", you MUST interpret it and convert it to the required 'YYYY-MM-DD' or 'HH:MM' format before using any tool. NEVER repeatedly ask the user for a specific format.

    Primary Directive: Follow this procedure step-by-step.

    0.  Pre-check Specialty: When a user asks to book an appointment with a specialty (e.g., "Cardiology"), your VERY FIRST action is to use the 'getDoctorDetails' tool with that specialty.
        - If the tool returns an empty list, you MUST immediately inform the user that this specialty is not available and stop the booking process.
        - If the tool returns doctors, then and ONLY then should you proceed to ask for the date and other information.

    1.  Analyze the User's Request:
        - If the user asks for a list of all available specialties, use the 'getAllSpecialties' tool.
        - If the user asks to list all doctors, use 'getDoctorDetails' without any parameters.
        - For booking, if the specialty is valid, determine if the user provided a specific date.
            - NO: Present the list of doctors and their next available dates to help the user choose.
            - YES: Interpret the user's date, then use 'getDoctorDetails' with BOTH 'specialty' and the formatted 'date' to find available doctors.
    
    2.  Confirm Doctor with User: After using 'getDoctorDetails', present the list of available doctors to the user. Once the user chooses one, you have the exact 'doctorName'.

    3.  Execute Final Action:
        - For booking, now that you have all the details, call the 'bookAppointment' tool.
        - For cancellation, you must follow the Fuzzy Name Resolution rule first, then interpret the user's date, and finally proceed with the 'cancelAppointment' tool.
        - For rescheduling, you must follow the Fuzzy Name Resolution rule first, then interpret the user's date, and finally proceed with the 'rescheduleAppointment' tool.
        
    Critical Rules for Accuracy:
    - No Hallucinations: If a tool returns no results, state that you could not find the information. DO NOT invent information.
    - Contextual Memory: If you have just identified a full doctor or patient name, use that exact information in subsequent steps.
    - Fuzzy Name Resolution: If a user provides a partial doctor's name for an action (e.g., "cancel appointment with Dr. Subbarao"), your first step MUST be to use the 'getDoctorDetails' tool with the partial 'doctorName' to find the full, correct name. Only after you have the exact full name should you call the 'cancelAppointment' or 'bookAppointment' tool.

    Other Instructions:
    - You are aware that the current date is ${currentDate}.
    - Do not provide medical advice.
    `;

    try {
        // We initialize the Google AI with our API key.
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // We select the specific model we want to use (Gemini 1.5 Flash).
        // We also tell the model about the "tools" it has available. These are the other serverless functions we've written.
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            // This is like giving the AI a toolbox. Each tool has a name, a description of what it does,
            // and what information it needs to work.
            tools: [{
                functionDeclarations: [
                    {
                        name: "getAllSpecialties",
                        description: "Gets a list of all medical specialties available at the hospital.",
                        parameters: { type: "OBJECT", properties: {} },
                    },
                    {
                        name: "getDoctorDetails",
                        description: "Finds doctors. Use with only 'specialty' for general availability or to validate a specialty. Use with 'specialty' and 'date' for a specific day. Use with 'doctorName' to resolve partial names. Use with no parameters to list all doctors.",
                        parameters: { 
                            type: "OBJECT", 
                            properties: { 
                                doctorName: { type: "STRING", description: "A partial or full name of the doctor to search for."},
                                specialty: { type: "STRING", description: "The medical specialty to search for (e.g., 'Radiology')." },
                                date: { type: "STRING", description: "Optional. The date to check for availability (YYYY-MM-DD)." } 
                            } 
                        },
                    },
                    {
                        name: "bookAppointment",
                        description: "Books a medical appointment once a specific doctor has been identified.",
                        parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "date", "time"] },
                    },
                    {
                        name: "cancelAppointment",
                        description: "Cancels an existing medical appointment.",
                        parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] },
                    },
                    {
                        name: "rescheduleAppointment",
                        description: "Reschedules an existing medical appointment to a new date and time.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                doctorName: { type: "STRING" }, patientName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" }
                            },
                            required: ["doctorName", "patientName", "oldDate", "newDate", "newTime"]
                        },
                    },
                ],
            }],
        }); 
        
        // We start a new chat session with the AI.
        // We provide the system prompt and the entire conversation history so the AI has full context.
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am Sahay, an AI assistant for Prudence Hospitals. How can I assist?" }] },
                ...history.slice(0, -1)
            ]
        });

        // We get the user's most recent message.
        const latestUserMessage = history[history.length - 1].parts[0].text;

        // We send the latest message to the AI and wait for its response.
        const result = await chat.sendMessage(latestUserMessage);
        const response = result.response;
        // After responding, we check if the AI decided to use one of its tools.
        const functionCalls = response.functionCalls();

        // If the AI wants to call a function (use a tool)...
        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            let toolResult;
            let toolUrl;

            // We figure out which tool the AI wants to use and set the correct URL for that function.
            if (call.name === 'getAllSpecialties') {
                toolUrl = `${event.headers.host}/.netlify/functions/getAllSpecialties`;
            } else if (call.name === 'getDoctorDetails') {
                toolUrl = `${event.headers.host}/.netlify/functions/getDoctorDetails`;
            } else if (call.name === 'bookAppointment') {
                toolUrl = `${event.headers.host}/.netlify/functions/bookAppointment`;
            } else if (call.name === 'cancelAppointment') {
                toolUrl = `${event.headers.host}/.netlify/functions/cancelAppointment`;
            } else if (call.name === 'rescheduleAppointment') {
                toolUrl = `${event.headers.host}/.netlify/functions/rescheduleAppointment`;
            }

            // If we found a valid tool URL...
            if (toolUrl) {
                // ...we call that function, passing along the arguments the AI provided.
                const toolResponse = await fetch(`https://${toolUrl}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(call.args),
                });

                // If the tool function returned an error, we package that error to send back to the AI.
                if (!toolResponse.ok) {
                    const errorBody = await toolResponse.text();
                    console.error(`Tool call to ${call.name} failed with status ${toolResponse.status}: ${errorBody}`);
                    toolResult = { 
                        error: `Tool execution failed with status: ${toolResponse.status}`, 
                        details: errorBody 
                    };
                } else {
                    // Otherwise, we get the successful result from the tool.
                    toolResult = await toolResponse.json();
                }
            } else {
                toolResult = { error: "Tool not found" };
            }

            // Now, we send a second message to the AI. This message contains the result of the tool call.
            // It's like saying, "Okay, I used the tool you asked for. Here's what I found."
            const result2 = await chat.sendMessage([
                { functionResponse: { name: call.name, response: toolResult } }
            ]);
            // The AI will now use this new information to generate its final, human-readable text response.
            const finalResponse = result2.response.text();
            // We send this final text response back to the user's chat interface.
            return { statusCode: 200, headers, body: JSON.stringify({ reply: finalResponse }) };
        }

        // If the AI did NOT decide to call a function, it means it generated a direct text reply.
        const text = response.text();
        // We just send that text reply straight back to the user.
        return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };

    } catch (error) {
        // This is the safety net for any unexpected errors during the entire AI process.
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to process request." }) };
    }
};

// Make the function available for Netlify to use.
export { handler };
