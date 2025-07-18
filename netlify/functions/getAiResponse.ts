// FILE: netlify/functions/getAiResponse.ts
// This is a simplified "echo" version for debugging the connection.

import type { Handler, HandlerEvent } from '@netlify/functions';

// Define common headers, including the CORS fix
const headers = {
  'Access-Control-Allow-Origin': '*', // Allows any origin to access this function
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const handler: Handler = async (event: HandlerEvent) => {
    console.log("--- Echo function started ---");

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
        console.log("Successfully parsed request body.");
    } catch (e) {
        console.error("Could not parse request body.", e);
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
    }

    const { history } = body;
    if (!history || !Array.isArray(history) || history.length === 0) {
        console.error("No history provided in request.");
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No history provided." }) };
    }

    // Get the latest user message from the history
    const latestUserMessage = history[history.length - 1].parts[0].text;
    console.log(`Received message: "${latestUserMessage}"`);

    // Create a simple echo response
    const echoResponse = `You said: "${latestUserMessage}". The connection is working.`;
    console.log(`Sending echo: "${echoResponse}"`);

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ reply: echoResponse }),
    };
};

export { handler };
