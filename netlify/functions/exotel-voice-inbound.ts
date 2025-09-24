// FILE: netlify/functions/exotel-voice-inbound.ts
// This function handles the initial incoming call from Exotel.

import type { Handler, HandlerEvent } from '@netlify/functions';

const handler: Handler = async (event: HandlerEvent) => {
    const headers = {
        'Content-Type': 'text/xml'
    };

    // This ExoML now points the <Gather> action to our new translator function.
    const exomlResponse = `
        <Response>
            <Say>Welcome to Prudence Hospitals. Sahay, your AI assistant, is here to help you.</Say>
            <Gather action="/.netlify/functions/exotel-gather-handler" method="POST" speechTimeout="auto" finishOnKey="#">
                <Say>How can I help you today?</Say>
            </Gather>
        </Response>
    `;

    return {
        statusCode: 200,
        headers,
        body: exomlResponse
    };
};

export { handler };
