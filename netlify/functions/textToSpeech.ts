import type { Handler, HandlerEvent } from '@netlify/functions';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS success' }) };
    }

    try {
        const { text } = JSON.parse(event.body || '{}');
        const apiKey = process.env.GEMINI_API_KEY;

        if (!text) return { statusCode: 400, headers, body: JSON.stringify({ error: "No text provided" }) };

        // Calling Gemini TTS (or your specific TTS provider)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
            method: 'POST',
            body: JSON.stringify({
                contents: [{ parts: [{ text }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
                }
            })
        });

        const result = await response.json();
        const audioData = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ audioContent: audioData })
        };
    } catch (error: any) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};