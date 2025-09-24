// FILE: netlify/functions/exotel-voice-inbound.ts
// This function handles the initial incoming call from Exotel.

import type { Handler } from '@netlify/functions';
// We use the Twilio helper library to generate TwiML, which Exotel understands.
import twilio from 'twilio';

const { VoiceResponse } = twilio.twiml;

export const handler: Handler = async (event) => {
    const response = new VoiceResponse();

    // The initial greeting message when a user calls.
    response.say({
            language: 'te-IN', // Set the language to Telugu
        },
        "నమస్తే! ప్రూడెన్స్ హాస్పిటల్స్‌కు స్వాగతం." // "Namaste! Welcome to Prudence Hospitals."
    );

    // After the greeting, immediately redirect the call to the main conversation handler.
    response.redirect({
            method: 'POST',
        },
        // IMPORTANT: Ensure this URL matches your live Netlify function path.
        `https://sahayhealth.netlify.app/.netlify/functions/exotel-gather-handler`
    );

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'text/xml',
        },
        body: response.toString(),
    };
};
