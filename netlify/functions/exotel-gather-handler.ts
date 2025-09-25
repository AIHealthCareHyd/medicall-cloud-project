// FILE: netlify/functions/exotel-gather-handler.ts
// PURPOSE: Acts as a stateful bridge between Exotel and the AI brain.
// It parses Exotel's form data, manages conversation history in Supabase,
// and calls the getAiResponse function with the correct JSON format.

import type { Handler, HandlerEvent } from '@netlify/functions';
import querystring from 'querystring';
import { supabase } from './lib/supabase-client';

// Define the structure of our conversation history
type ChatPart = { text: string };
type ChatMessage = {
    role: 'user' | 'model';
    parts: ChatPart[];
};

const handler: Handler = async (event: HandlerEvent) => {
    // 1. Parse incoming data from Exotel
    const params = querystring.parse(event.body || '');
    const speechText = params.SpeechText as string | undefined;
    const callSid = params.CallSid as string; // Crucial for session management

    if (!callSid) {
        // Exotel should always send a CallSid. If not, we can't proceed.
        return { statusCode: 400, body: "CallSid is missing." };
    }

    // 2. Retrieve conversation history from Supabase
    let history: ChatMessage[] = [];
    const { data: sessionData, error: sessionError } = await supabase
        .from('exotel_sessions')
        .select('history')
        .eq('call_sid', callSid)
        .single();

    if (sessionData && sessionData.history) {
        history = sessionData.history;
    }
    
    // If the user didn't say anything, repeat the last prompt or a generic one.
    if (!speechText) {
        const exomlResponse = `
            <Response>
                <Say voice="MALE">I'm sorry, I didn't catch that. Could you please repeat?</Say>
                <Gather action="${event.rawUrl}" method="POST" speechTimeout="auto" finishOnKey="#">
                </Gather>
            </Response>
        `;
        return { statusCode: 200, headers: { 'Content-Type': 'text/xml' }, body: exomlResponse };
    }

    // 3. Update history with the user's new message
    history.push({ role: 'user', parts: [{ text: speechText }] });

    // 4. Call the core AI function with the correct JSON format
    const host = event.headers.host || 'sahayhealth.netlify.app';
    const aiFunctionUrl = `https://${host}/.netlify/functions/getAiResponse`;
    let aiReplyText = "I am sorry, I seem to be having trouble. Please call back later.";

    try {
        const aiResponse = await fetch(aiFunctionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: history }), // Send the full history
        });

        if (aiResponse.ok) {
            const data = await aiResponse.json();
            aiReplyText = data.reply;
            // Add AI's response to history for the next turn
            history.push({ role: 'model', parts: [{ text: aiReplyText }] });
        }
    } catch (error) {
        console.error("Error calling getAiResponse function:", error);
    }

    // 5. Save the updated history back to Supabase
    await supabase
        .from('exotel_sessions')
        .upsert({ call_sid: callSid, history: history });

    // 6. Respond to Exotel to continue the conversation loop
    const exomlResponse = `
        <Response>
            <Say voice="MALE">${aiReplyText}</Say>
            <Gather action="${event.rawUrl}" method="POST" speechTimeout="auto" finishOnKey="#">
                <Say voice="MALE">Is there anything else?</Say>
            </Gather>
        </Response>
    `;

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: exomlResponse
    };
};

export { handler };
