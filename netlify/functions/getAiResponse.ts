import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const getFormattedDate = (date: Date): string => {
    return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS success' }) };
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
    if (!history || !Array.isArray(history)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No history provided." }) };
    }
    
    const todayStr = getFormattedDate(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = getFormattedDate(tomorrow);

    const systemPrompt = `
    You are Sahay, a friendly AI medical assistant for Prudence Hospitals.
    **You MUST conduct the entire conversation in Telugu.**

    **Rules:**
    - Today is ${todayStr}. Tomorrow is ${tomorrowStr}.
    - Silently convert natural dates (like "రేపు") to 'YYYY-MM-DD' before calling tools.
    - Workflow: Understand need -> Find Doctor -> Check Slots -> Collect Details -> Book/Cancel/Reschedule.
    `;

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{
                functionDeclarations: [
                    { 
                        name: "getAvailableSlots", 
                        description: "Check available times for a doctor.", 
                        parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, date: { type: "STRING" }, timeOfDay: { type: "STRING" } }, required: ["doctorName", "date"] } 
                    },
                    { 
                        name: "getAllSpecialties", 
                        description: "List hospital departments.", 
                        parameters: { type: "OBJECT", properties: {} } 
                    },
                    { 
                        name: "getDoctorDetails", 
                        description: "Find doctors by name or specialty.", 
                        parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } 
                    },
                    { 
                        name: "bookAppointment", 
                        description: "Create a new booking.", 
                        parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } 
                    },
                    { 
                        name: "cancelAppointment", 
                        description: "Cancel an existing booking.", 
                        parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] } 
                    },
                    { 
                        name: "rescheduleAppointment", 
                        description: "Change an appointment date/time.", 
                        parameters: { type: "OBJECT", properties: { patientName: { type: "STRING" }, doctorName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" } }, required: ["patientName", "doctorName", "oldDate", "newDate", "newTime"] } 
                    },
                ],
            }],
        }); 
        
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "అర్థమైంది. నేను సహాయం చేయడానికి సిద్ధంగా ఉన్నాను." }] },
                ...history
            ]
        });

        const latestUserMessage = history.length > 0 ? history[history.length - 1].parts[0].text : "నమస్కారం";
        const result = await chat.sendMessage(latestUserMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            
            // Build the URL to call the tool
            const host = event.headers.host || 'localhost:8888';
            const protocol = host.includes('localhost') ? 'http' : 'https';
            const toolUrl = `${protocol}://${host}/.netlify/functions/${call.name}`;
            
            const toolResponse = await fetch(toolUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(call.args),
            });

            const toolResult = await toolResponse.json();
            const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }]);
            
            return { statusCode: 200, headers, body: JSON.stringify({ reply: result2.response.text() }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ reply: response.text() }) };

    } catch (error: any) {
        console.error("Brain Error:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to process request." }) };
    }
};