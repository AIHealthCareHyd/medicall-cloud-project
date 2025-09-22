// FILE: netlify/functions/getAiResponse.ts
import { GoogleGenerativeAI, ChatSession } from '@google/generative-ai';
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

/**
 * Initializes the Generative AI model and starts a chat session.
 */
function initializeChat(apiKey: string, systemPrompt: string, history: any[]): ChatSession {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        tools: {
            functionDeclarations: [
                { 
                    name: "getAvailableSlots", 
                    description: "Gets available time slots for a doctor. If 'timeOfDay' is not provided, it returns available periods (morning, afternoon). If 'timeOfDay' IS provided, it returns specific times for that period.", 
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
                { name: "getAllSpecialties", description: "Gets a list of all unique medical specialties available at the hospital.", parameters: { type: "OBJECT", properties: {} } },
                { name: "getDoctorDetails", description: "Finds doctors by specialty or name.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, specialty: { type: "STRING" } } } },
                { name: "bookAppointment", description: "Books a medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, phone: { type: "STRING" }, date: { type: "STRING" }, time: { type: "STRING" } }, required: ["doctorName", "patientName", "phone", "date", "time"] } },
                { name: "cancelAppointment", description: "Cancels an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, date: { type: "STRING" } }, required: ["doctorName", "patientName", "date"] } },
                { name: "rescheduleAppointment", description: "Reschedules an existing medical appointment.", parameters: { type: "OBJECT", properties: { doctorName: { type: "STRING" }, patientName: { type: "STRING" }, oldDate: { type: "STRING" }, newDate: { type: "STRING" }, newTime: { type: "STRING" } }, required: ["doctorName", "patientName", "oldDate", "newDate", "newTime"] } },
            ]
        }
    }); 
    
    // Construct the initial chat history
    const chatHistory = [
        { role: "user", parts: [{ text: systemPrompt }] },
        // --- TRANSLATED TEXT ---
        { role: "model", parts: [{ text: "అర్థమైంది. నేను షెడ్యూల్‌లను తనిఖీ చేయడానికి బహుళ-దశల ప్రక్రియను అనుసరిస్తాను. ఈ రోజు అపాయింట్‌మెంట్ బుక్ చేసుకోవడానికి నేను మీకు ఎలా సహాయపడగలను?" }] },
        ...history.slice(0, -1)
    ];

    return model.startChat({ history: chatHistory });
}

/**
 * Handles the execution of tool function calls.
 */
async function handleToolCalls(functionCalls: any[], chat: ChatSession, event: HandlerEvent): Promise<string> {
    const call = functionCalls[0];
    const host = event.headers.host || 'sahayhealth.netlify.app';
    const toolUrl = `https://${host}/.netlify/functions/${call.name}`;
    
    const toolResponse = await fetch(toolUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(call.args),
    });

    if (!toolResponse.ok) {
        const errorText = await toolResponse.text();
        console.error(`Tool call to ${call.name} failed with status ${toolResponse.status}: ${errorText}`);
        throw new Error(`Tool call to ${call.name} failed.`);
    }

    const toolResult = await toolResponse.json();

    const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }]);
    return result2.response.text();
}

// --- Main Netlify Function Handler ---
export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    if (!process.env.GEMINI_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "AI configuration error." }) };
    }
    
    try {
        const body = JSON.parse(event.body || '{}');
        const { history } = body;

        if (!history || !Array.isArray(history) || history.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "No history provided." }) };
        }
        
        const currentDate = new Date().toLocaleDateString('en-CA');
        
        // --- TRANSLATED TEXT ---
        const systemPrompt = `
        మీరు సహాయ్, ప్రూడెన్స్ హాస్పిటల్స్ కోసం స్నేహపూర్వక మరియు అత్యంత కచ్చితమైన AI మెడికల్ అపాయింట్‌మెంట్ అసిస్టెంట్.

        **కొత్త అపాయింట్‌మెంట్ల కోసం వర్క్‌ఫ్లో:**
        1.  **అవసరాన్ని అర్థం చేసుకోండి:** లక్షణాలు లేదా స్పెషాలిటీ కోసం అడగండి.
        2.  **డాక్టర్‌ను కనుగొనండి:** 'getDoctorDetails' సాధనాన్ని ఉపయోగించి డాక్టర్‌ను కనుగొనండి. వినియోగదారు నిర్ధారించిన తర్వాత, ముందుకు సాగండి.
        3.  **తేదీని పొందండి:** వినియోగదారుని వారి ఇష్టపడే తేదీని అడగండి.
        4.  **షెడ్యూల్‌ను తనిఖీ చేయండి (క్లిష్టమైన బహుళ-దశల ప్రక్రియ):**
            a. **మొదటి కాల్:** డాక్టర్ పేరు మరియు తేదీతో మాత్రమే 'getAvailableSlots' సాధనాన్ని కాల్ చేయండి. ఈ సాధనం అందుబాటులో ఉన్న సమయ వ్యవధులను (ఉదా., ["ఉదయం", "మధ్యాహ్నం"]) అందిస్తుంది.
            b. **వినియోగదారుని అడగండి:** తిరిగి వచ్చిన సమయ వ్యవధుల ఆధారంగా, వినియోగదారుని వారి ప్రాధాన్యతను అడగండి. ఉదాహరణకు: "డాక్టర్‌కు ఉదయం మరియు మధ్యాహ్నం ఖాళీలు ఉన్నాయి. మీకు ఏది కావాలి?"
            c. **రెండవ కాల్:** వినియోగదారు ప్రతిస్పందించిన తర్వాత (ఉదా., "ఉదయం"), 'getAvailableSlots' సాధనాన్ని మళ్ళీ కాల్ చేయండి. ఈసారి, వారి ఎంపికను చేర్చండి. (ఉదా., doctorName, date, మరియు timeOfDay: 'morning').
            d. **నిర్దిష్ట సమయాలను అందించండి:** ఈ సాధనం ఇప్పుడు నిర్దిష్ట సమయాల చిన్న జాబితాను అందిస్తుంది. ఈ ఎంపికలను వినియోగదారునికి అందించండి.
        5.  **తుది వివరాలను సేకరించండి:** వారు ఒక సమయాన్ని ఎంచుకున్న తర్వాత, రోగి పేరు మరియు ఫోన్ నంబర్‌ను పొందండి.
        6.  **తుది నిర్ధారణ & బుకింగ్:** అన్ని వివరాలను నిర్ధారించి, ఆపై 'bookAppointment' సాధనాన్ని కాల్ చేయండి.
        
        **ఇతర నియమాలు:**
        - మొదటి 'getAvailableSlots' కాల్ ఖాళీ జాబితాను అందిస్తే, డాక్టర్ ఆ రోజు పూర్తిగా బుక్ అయ్యారని వినియోగదారునికి తెలియజేయండి.
        - నేటి తేదీ ${currentDate}.
        - వైద్య సలహా ఇవ్వవద్దు.
        `;

        const chat = initializeChat(process.env.GEMINI_API_KEY, systemPrompt, history);
        const latestUserMessage = history[history.length - 1].parts[0].text;

        const result = await chat.sendMessage(latestUserMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        let finalReply: string;

        if (functionCalls && functionCalls.length > 0) {
            finalReply = await handleToolCalls(functionCalls, chat, event);
        } else {
            finalReply = response.text();
        }

        return { statusCode: 200, headers, body: JSON.stringify({ reply: finalReply }) };

    } catch (error: any) {
        console.error("FATAL: Error in getAiResponse handler.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Failed to process request: ${error.message}` }) };
    }
};

