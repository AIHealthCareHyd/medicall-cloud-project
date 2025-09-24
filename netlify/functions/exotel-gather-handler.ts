// FILE: netlify/functions/exotel-gather-handler.ts
// This is the robust, stateful version that correctly integrates with all services.

import type { Handler, HandlerEvent } from '@netlify/functions';
import twilio from 'twilio';
import querystring from 'querystring';

const { VoiceResponse } = twilio.twiml;

// This is the main function that handles the back-and-forth conversation.
export const handler: Handler = async (event: HandlerEvent) => {
    const response = new VoiceResponse();
    const body = querystring.parse(event.body || '');

    // Use the caller's phone number as the unique session ID. This is crucial for maintaining conversation history.
    // Fallback to a random ID if the 'From' field is somehow missing.
    const sessionId = (body.From as string) || `unknown-caller-${Date.now()}`;
    
    // Get the user's speech from the last <Gather> instruction.
    // If it's the first time this handler is called (i.e., redirected from the inbound call),
    // we start the conversation by sending "hello" to the AI.
    const userMessage = (body.SpeechResult as string) || 'hello';

    try {
        // STEP 1: Get the AI's text response from the AI brain, maintaining the session.
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

        // STEP 2: Convert the AI's Telugu text response into playable audio.
        const ttsResponse = await fetch(`https://${event.headers.host}/.netlify/functions/textToSpeech`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: teluguText }),
        });

        if (!ttsResponse.ok) {
            const errorDetails = await ttsResponse.text();
            throw new Error(`TTS response function failed with status ${ttsResponse.status}: ${errorDetails}`);
        }
        
        const ttsData = await ttsResponse.json();
        const audioContent = ttsData.audioContent; // This is a Base64 encoded MP3 string.

        // STEP 3: Tell Exotel to play the generated audio back to the user.
        // We use a Data URI to play the Base64 audio directly.
        response.play({}, `data:audio/mp3;base64,${audioContent}`);
        
        // STEP 4: Tell Exotel to listen for the user's next response and send it back to this same function.
        // This creates the conversation loop.
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
        response.say({ language: 'te-IN' }, "క్షమించండి, ఒక లోపం సంభవించింది. దయచేసి మళ్ళీ ప్రయత్నించండి."); // "Sorry, an error occurred. Please try again."
    }

    // Return the final instructions to Exotel in the valid XML format.
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: response.toString(),
    };
};

