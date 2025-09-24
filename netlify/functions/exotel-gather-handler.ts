// FILE: netlify/functions/exotel-gather-handler.ts
// This version fixes a critical bug by correctly parsing Exotel's parameters.

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
    
    // --- BUG FIX IS HERE ---
    // Exotel uses 'SpeechText', not 'SpeechResult' like Twilio.
    // We now correctly look for 'SpeechText' and default to "hello" for the first turn.
    const userMessage = (body.SpeechText as string) || 'hello';

    console.log(`Session ID: ${sessionId}`);
    console.log(`User Message (SpeechText): ${userMessage}`);

    // Check if it's the very first interaction (no speech was gathered yet).
    const isFirstTurn = !body.SpeechText;
    console.log(`Is this the first turn of the conversation? ${isFirstTurn}`);

    try {
        if (isFirstTurn) {
            // If it's the first turn, play the welcome message.
            console.log("First turn detected. Playing welcome message.");
            response.say({ language: 'te-IN' }, "నమస్తే! ప్రూడెన్స్ హాస్పిటల్స్‌కు స్వాగతం.");
        }
        
        // For ALL turns (including the first), we need to get the AI's next response.
        console.log("Calling getAiResponse function...");
        const aiResponse = await fetch(`https://${event.headers.host}/.netlify/functions/getAiResponse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, userMessage }),
        });

        console.log(`AI Response Status: ${aiResponse.status}`);
        if (!aiResponse.ok) {
            throw new Error(`AI response function failed with status ${aiResponse.status}`);
        }

        const aiData = await aiResponse.json();
        const teluguText = aiData.reply;
        console.log("Received text from AI:", teluguText);

        // Use Exotel's native TTS to speak the AI's response.
        response.say({ language: 'te-IN' }, teluguText);
        
        // After speaking, listen for the user's input.
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

