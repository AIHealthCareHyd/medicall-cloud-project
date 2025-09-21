// FILE: netlify/functions/textToSpeech.ts
import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }
    // --- CHANGE IS HERE: Updated to match your environment variable name ---
    if (!process.env.TEXT_TO_SPEACH) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Text-to-Speech API key is not configured." }) };
    }

    try {
        const { text } = JSON.parse(event.body || '{}');
        if (!text) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "No text provided to synthesize." }) };
        }

        const apiKey = process.env.TEXT_TO_SPEACH;
        // --- END OF CHANGE ---
        const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

        const requestBody = {
            input: { text },
            voice: {
                languageCode: 'te-IN',
                name: 'te-IN-Wavenet-A' // A standard, high-quality Telugu voice
            },
            audioConfig: {
                audioEncoding: 'MP3'
            }
        };

        const ttsResponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!ttsResponse.ok) {
            const errorDetails = await ttsResponse.json();
            console.error("Google TTS API Error:", errorDetails);
            throw new Error(`Google TTS API responded with status ${ttsResponse.status}`);
        }

        const ttsData = await ttsResponse.json();
        
        // The audio is returned as a base64 encoded string
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ audioContent: ttsData.audioContent })
        };

    } catch (error: any) {
        console.error("FATAL: Error in textToSpeech function.", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Failed to process text-to-speech request: ${error.message}` }) };
    }
};

export { handler };    


