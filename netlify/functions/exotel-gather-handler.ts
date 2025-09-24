// FILE: netlify/functions/exotel-gather-handler.ts
// This function acts as a translator between Exotel and our main AI brain.

import type { Handler, HandlerEvent } from '@netlify/functions';
import querystring from 'querystring';

const handler: Handler = async (event: HandlerEvent) => {
    // 1. Parse the incoming form data from Exotel
    const params = querystring.parse(event.body || '');
    const speechText = params.SpeechText as string || 'No input received.';

    // This is a placeholder for conversation history which we would need to implement
    // using a database (like Supabase) in a real production system.
    // For now, we'll create a simple history object for each turn.
    const historyForAI = [
        { role: 'user', parts: [{ text: speechText }] }
    ];

    // 2. Call our main AI brain function internally
    const aiFunctionUrl = `https://${event.headers.host}/.netlify/functions/getAiResponse`;
    let aiReplyText = "I'm sorry, I encountered an error.";

    try {
        const aiResponse = await fetch(aiFunctionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: historyForAI }),
        });

        if (aiResponse.ok) {
            const data = await aiResponse.json();
            aiReplyText = data.reply;
        }
    } catch (error) {
        console.error("Error calling getAiResponse function:", error);
    }

    // 3. Convert the AI's text response back into ExoML for Exotel
    const exomlResponse = `
        <Response>
            <Say>${aiReplyText}</Say>
            <Gather action="/.netlify/functions/exotel-gather-handler" method="POST" speechTimeout="auto">
                <Say>Is there anything else?</Say>
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
