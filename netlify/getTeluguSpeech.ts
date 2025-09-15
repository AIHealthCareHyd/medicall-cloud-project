// FILE: netlify/functions/getTeluguSpeech.ts
// This is the corrected version that securely uses the environment variable.

import type { Handler, HandlerEvent } from '@netlify/functions';

// You may need to update this if your Text-to-Speech service has a different endpoint.
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

    // This is the SECURE way to access your key.
    // It reads the value you saved in the Netlify UI.
    if (!process.env.TEXT_TO_SPEECH_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Text-to-Speech API key not configured." }) };
    }

    try {
        const { text } = JSON.parse(event.body || '{}');
        if (!text) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "No text provided to synthesize." }) };
        }

        // The API key is securely referenced here.
        const apiKey = process.env.TEXT_TO_SPEECH_API_KEY;

        const response = await fetch(TTS_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                text: text,
                voice: 'te-IN-Standard-A',
                format: 'mp3'
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`TTS API Error: ${response.status} - ${errorBody}`);
        }
        
        const audioBlob = await response.blob();
        
        // This is a more robust way to handle the Blob-to-Base64 conversion in a serverless environment.
        const buffer = Buffer.from(await audioBlob.arrayBuffer());
        const base64data = `data:${audioBlob.type};base64,${buffer.toString('base64')}`;

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioContent: base64data })
        };

    } catch (error: any) {
        console.error("Error in getTeluguSpeech function:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};

export { handler };

