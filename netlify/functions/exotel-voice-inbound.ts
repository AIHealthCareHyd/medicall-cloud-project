// FILE: netlify/functions/exotel-voice-inbound.ts
// This function handles the initial incoming call from Exotel.

import type { Handler, HandlerEvent } from '@netlify/functions';

const handler: Handler = async (event: HandlerEvent) => {
    // Exotel expects a response with a specific XML content type
    const headers = {
        'Content-Type': 'text/xml'
    };

    // This is ExoML, Exotel's XML-based instruction language.
    // It tells Exotel what to do when someone calls.
    const exomlResponse = `
        <Response>
            <Say>Welcome to Prudence Hospitals. Sahay, your AI assistant, is here to help you.</Say>
            <Gather action="/.netlify/functions/getAiResponse" method="POST" speechTimeout="auto" finishOnKey="#">
                <Say>How can I help you today?</Say>
            </Gather>
        </Response>
    `;

    // Note: The 'action' in <Gather> points to your existing getAiResponse function.
    // We will need to adapt getAiResponse to handle requests from Exotel instead of the web frontend.

    return {
        statusCode: 200,
        headers,
        body: exomlResponse
    };
};

export { handler };
