// FILE: netlify/functions/getTeluguSpeech.ts
// This new function securely handles your Text-to-Speech API key.

import type { Handler, HandlerEvent } from '@netlify/functions';

// IMPORTANT: Replace this with the actual API endpoint for your Text-to-Speech service.
const TTS_API_ENDPOINT = 'https://api.texttospeechservice.com/v1/synthesize'; 

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    // Securely access the new API key you just added to Netlify.
    if (!process.env.TEXT_TO_SPEECH_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Text-to-Speech API key not configured." }) };
    }

    try {
        const { text } = JSON.parse(event.body || '{}');
        if (!text) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "No text provided to synthesize." }) };
        }

        const apiKey = process.env.TEXT_TO_SPEECH_API_KEY;

        // This is a standard request structure. You may need to adjust the body
        // based on your specific API's documentation (e.g., voice ID, format).
        const response = await fetch(TTS_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}` // Common authorization method
            },
            body: JSON.stringify({
                text: text,
                voice: 'te-IN-Standard-A', // Example voice ID for Telugu
                format: 'mp3' // Example audio format
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`TTS API Error: ${response.status} - ${errorBody}`);
        }

        // The API might return the audio data directly or a link to it.
        // This example assumes it returns the audio data as a base64 string.
        const audioBlob = await response.blob();
        const reader = new FileReader();
        const base64data = await new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(audioBlob);
        });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioContent: base64data }) // Sending audio back to the frontend
        };

    } catch (error: any) {
        console.error("Error in getTeluguSpeech function:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};

export { handler };
