// FILE: netlify/functions/exotel-gather-handler.ts
// This is the robust, stateful version that correctly integrates with all services.
// This version has been simplified to use Exotel's native TTS for reliability.

import type { Handler, HandlerEvent } from '@netlify/functions';
import twilio from 'twilio';
import querystring from 'querystring';

const { VoiceResponse } = twilio.twiml;

// This is the main function that handles the back-and-forth conversation.
export const handler: Handler = async (event: HandlerEvent) => {
    const response = new VoiceResponse();
    const body = querystring.parse(event.body || '');

    // Use the caller's phone number as the unique session ID for conversation history.
    const sessionId = (body.From as string) || `unknown-caller-${Date.now()}`;
    
    // Get the user's speech from the last <Gather> instruction.
    // If it's the first time this handler is called, start the conversation by sending "hello".
    const userMessage = (body.SpeechResult as string) || 'hello';

    try {
        // STEP 1: Get the AI's text response from the AI brain.
        const aiResponse = await fetch(`https://${event.headers.host}/.netlify/functions/getAiResponse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, userMessage }),
        });

        if (!aiResponse.ok) {
            const errorDetails = await aiResponse.text();
            throw new Error(`AI response function failed with status ${aiResponse.status}: ${errorDetails}`);
        }

        const aiData = await aiResponse.json();
        const teluguText = aiData.reply;

        // STEP 2 (REVISED): Instead of converting to audio ourselves, we will tell
        // Exotel to speak the Telugu text directly using its native TTS engine.
        response.say({
            language: 'te-IN', // Specify the language for the TTS engine
        }, teluguText);
        
        // STEP 3: Tell Exotel to listen for the user's next response.
        response.gather({
            input: 'speech',
            speechTimeout: 'auto', // Exotel will automatically detect when the user stops talking.
            language: 'te-IN',
            action: `https://sahayhealth.netlify.app/.netlify/functions/exotel-gather-handler`,
            method: 'POST',
        });

    } catch (error) {
        console.error("FATAL: Error in exotel-gather-handler:", error);
        // If anything goes wrong, play a generic error message to the user.
        response.say({ language: 'te-IN' }, "క్షమించండి, ఒక లోపం సంభవించింది. దయచేసి మళ్ళీ ప్రయత్నించండి.");
    }

    // Return the final instructions to Exotel in the valid XML format.
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: response.toString(),
    };
};

