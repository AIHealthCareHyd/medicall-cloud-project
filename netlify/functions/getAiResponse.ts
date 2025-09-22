// FILE: netlify/functions/getAiResponse.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const getFormattedDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
}

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    if (!process.env.GEMINI_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Configuration error." }) };
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
    
    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        const { data: specialtiesData, error: specialtiesError } = await supabase.from('doctors').select('specialty');
        if (specialtiesError) throw specialtiesError;
        const specialtyList = [...new Set(specialtiesData.map(doc => doc.specialty))];
        const specialtyListString = specialtyList.join(', ');

        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);
        const todayStr = getFormattedDate(today);
        const tomorrowStr = getFormattedDate(tomorrow);

        const systemPrompt = `
        You are Sahay, a friendly and highly accurate AI medical appointment assistant for Prudence Hospitals.

        **Primary Instruction: You MUST conduct the entire conversation in Telugu.**

        **List of Available Specialties:**
        Here are the only specialties available at the hospital: [${specialtyListString}]

        **Internal Rules & Date Handling (CRITICAL):**
        - Today's date is ${todayStr}. Tomorrow's date is ${tomorrowStr}.
        - You MUST silently convert natural language dates and times into 'YYYY-MM-DD' and 'HH:MM' formats before calling tools.
        - NEVER mention date or time formats to the user.

        **Workflow for New Appointments (Follow this order STRICTLY):**
        1.  **Understand Need:** Ask for symptoms or specialty in Telugu.
        2.  **Find & Present Real Doctors (CRITICAL ANTI-HALLUCINATION WORKFLOW):**
            a. **Silently Match Specialty:** Take the user's input (e.g., "gasentrology"). Silently and confidently find the closest match from your 'List of Available Specialties' (e.g., "Surgical Gastroenterology"). It is forbidden to ask for confirmation or mention the user's spelling.
            b. **Immediately Call Tool:** You MUST immediately use this corrected specialty to call the 'getDoctorDetails' tool.
            c. **Present ONLY Real Data:** The tool will return a list of real doctors. You are FORBIDDEN from inventing, hallucinating, or suggesting any doctor's name that was not in the tool's output. You MUST present only the exact, real names from the list to the user.
        3.  **Get User's Choice & Date:** Once the user confirms a doctor from the real list, ask for their preferred date.
        4.  **Check Schedule (Multi-Step):**
            a. First, call 'getAvailableSlots' to get available periods (morning/afternoon).
            b. Ask the user for their preference.
            c. Call 'getAvailableSlots' again with their preference to get specific times.
            d. Present the specific times to the user.
        5.  **Gather Final Details & Confirm:** Get the patient's name and phone, then confirm all details in Telugu.
        6.  **Execute Booking (MANDATORY FINAL ACTION):** After the user gives their final "yes" or "ok", your only possible next action is to call the 'bookAppointment' tool. Do not say anything else. You MUST call the tool.
        `;

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{
                functionDeclarations: [
                    { 
                        name: "getAvailableSlots", 
                        description: "Gets available time slots for a doctor. If 'timeOfDay' is not provided, it returns available periods. If 'timeOfDay' IS provided, it returns specific times.", 
                        parameters: { 
                            type: "OBJECT", 
                            properties: { 
                                doctorName: { type: "STRING" }, 
                                date: { type: "STRING" },
                                timeOfDay: { type: "STRING", description: "Optional. Can be 'morning', 'afternoon', or 'evening'." } 
                            }, 
                            required: ["doctorName", "date"] 
                        } 
                    },
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
                { role: "model", parts: [{ text: "అర్థమైంది. నేను స్పెల్లింగ్ తప్పులను అంతర్గతంగా సరిచేసి, నిర్ధారణ కోసం అడగకుండా నేరుగా డాక్టర్‌ను కనుగొంటాను. నేను మీకు ఎలా సహాయపడగలను?" }] },
                ...history.slice(0, -1)
            ]
        });

        const latestUserMessage = history[history.length - 1].parts[0].text;

        const result = await chat.sendMessage(latestUserMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            let toolResult;
            const host = event.headers.host || 'sahayhealth.netlify.app';
            const toolUrl = `https://${host}/.netlify/functions/${call.name}`;
            
            const toolResponse = await fetch(toolUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(call.args),
            });
             if (!toolResponse.ok) {
                toolResult = { error: `Tool call to ${call.name} failed with status ${toolResponse.status}` };
            } else {
                 toolResult = await toolResponse.json();
            }

            const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }]);
            const finalResponse = result2.response.text();
            return { statusCode: 200, headers, body: JSON.stringify({ reply: finalResponse }) };
        }

        const text = response.text();
        return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };

    } catch (error: any) {
        console.error("FATAL: Error during Gemini API call or tool execution.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Failed to process request.` }) };
    }
};

export { handler };

