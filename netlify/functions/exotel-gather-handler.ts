// FILE: netlify/functions/exotel-gather-handler.ts
// This version contains the final logic fix to correctly separate the first-turn greeting from the main conversation loop.

import type { Handler, HandlerEvent } from '@netlify/functions';
import twilio from 'twilio';
import querystring from 'querystring';

const { VoiceResponse } = twilio.twiml;

export const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- Exotel Gather Handler Invoked ---");

    const response = new VoiceResponse();
    const body = querystring.parse(event.body || '');

    console.log("Received body from Exotel:", body);

    const sessionId = (body.From as string) || `unknown-caller-${Date.now()}`;
    
    // Exotel uses 'SpeechText'. This will be undefined on the first turn.
    const userMessage = body.SpeechText as string;
    const isFirstTurn = !userMessage;

    console.log(`Session ID: ${sessionId}`);
    console.log(`User Message (SpeechText): ${userMessage}`);
    console.log(`Is this the first turn? ${isFirstTurn}`);

    try {
        if (isFirstTurn) {
            // --- FIRST TURN LOGIC ---
            // On the very first turn, we do two things ONLY:
            // 1. Say the welcome message.
            // 2. Immediately get the AI's first question.
            console.log("First turn detected. Getting initial AI response.");

            const aiResponse = await fetch(`https://${event.headers.host}/.netlify/functions/getAiResponse`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // We send "hello" to trigger the AI's first workflow step.
                body: JSON.stringify({ sessionId, userMessage: 'hello' }),
            });
            
            if (!aiResponse.ok) throw new Error(`AI response failed: ${aiResponse.status}`);
            
            const aiData = await aiResponse.json();
            console.log("Received initial response from AI:", aiData.reply);
            response.say({ language: 'te-IN' }, aiData.reply);

        } else {
            // --- SUBSEQUENT TURNS LOGIC ---
            // For every other turn, we process the user's actual speech.
            console.log("Subsequent turn. Processing user speech...");
            const aiResponse = await fetch(`https://${event.headers.host}/.netlify/functions/getAiResponse`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, userMessage }),
            });

            if (!aiResponse.ok) throw new Error(`AI response failed: ${aiResponse.status}`);
            
            const aiData = await aiResponse.json();
            console.log("Received subsequent response from AI:", aiData.reply);
            response.say({ language: 'te-IN' }, aiData.reply);
        }
        
        // For ALL turns, after speaking, we listen for the user's next input.
        console.log("Adding <Gather> to the response.");
        response.gather({
            input: 'speech',
            speechTimeout: 'auto',
            language: 'te-IN',
            action: `https://sahayhealth.netlify.app/.netlify/functions/exotel-gather-handler`,
            method: 'POST',
        });

    } catch (error) {
        console.error("FATAL: Error in exotel-gather-handler:", error);
        response.say({ language: 'te-IN' }, "క్షమించండి, ఒక లోపం సంభవించింది. దయచేసి మళ్ళీ ప్రయత్నించండి.");
    }

    const finalTwiML = response.toString();
    console.log("Final TwiML Response to be sent to Exotel:", finalTwiML);

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: finalTwiML,
    };
};

