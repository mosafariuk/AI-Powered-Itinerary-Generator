import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
let firebaseApp;
let db;

function initializeFirebase(serviceAccountKey) {
  if (!firebaseApp) {
    firebaseApp = initializeApp({
      credential: cert(JSON.parse(serviceAccountKey))
    });
    db = getFirestore(firebaseApp);
  }
  return db;
}

// Generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// LLM prompt template
function createItineraryPrompt(destination, durationDays) {
  return `You are a professional travel planner. Create a detailed ${durationDays}-day itinerary for ${destination}.

Return your response as a valid JSON array where each element represents one day. Each day should have this exact structure:

{
  "day": 1,
  "theme": "Brief theme for the day",
  "activities": [
    {
      "time": "Morning" | "Afternoon" | "Evening",
      "description": "Detailed activity description with practical tips",
      "location": "Specific location name"
    }
  ]
}

Requirements:
- Include 3-4 activities per day (Morning, Afternoon, Evening, and optionally Late Evening)
- Provide practical, actionable descriptions
- Include specific location names
- Consider travel time between locations
- Mix cultural, historical, and leisure activities
- Return ONLY the JSON array, no other text

Destination: ${destination}
Duration: ${durationDays} days`;
}

// Call OpenAI API
async function generateItinerary(destination, durationDays, apiKey) {
  const prompt = createItineraryPrompt(destination, durationDays);
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a professional travel planner. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} - ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content.trim();
  
  // Parse the JSON response
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse LLM response as JSON: ${error.message}`);
  }
}

// Process itinerary generation asynchronously
async function processItineraryGeneration(jobId, destination, durationDays, db, openaiApiKey) {
  try {
    // Generate itinerary using LLM
    const itinerary = await generateItinerary(destination, durationDays, openaiApiKey);
    
    // Update Firestore document with completed itinerary
    await db.collection('itineraries').doc(jobId).update({
      status: 'completed',
      itinerary: itinerary,
      completedAt: new Date(),
      error: null
    });
    
    console.log(`Itinerary generation completed for job ${jobId}`);
  } catch (error) {
    console.error(`Error generating itinerary for job ${jobId}:`, error);
    
    // Update Firestore document with error status
    await db.collection('itineraries').doc(jobId).update({
      status: 'failed',
      completedAt: new Date(),
      error: error.message
    });
  }
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders 
      });
    }

    try {
      // Parse request body
      const body = await request.json();
      const { destination, durationDays } = body;

      // Validate input
      if (!destination || typeof destination !== 'string') {
        return new Response(JSON.stringify({ error: 'destination is required and must be a string' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (!durationDays || typeof durationDays !== 'number' || durationDays < 1 || durationDays > 30) {
        return new Response(JSON.stringify({ error: 'durationDays is required and must be a number between 1 and 30' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Initialize Firebase
      const database = initializeFirebase(env.FIREBASE_SERVICE_ACCOUNT_KEY);

      // Generate unique job ID
      const jobId = generateUUID();

      // Create initial document in Firestore
      await database.collection('itineraries').doc(jobId).set({
        status: 'processing',
        destination: destination,
        durationDays: durationDays,
        createdAt: new Date(),
        completedAt: null,
        itinerary: null,
        error: null
      });

      // Start asynchronous processing using waitUntil
      ctx.waitUntil(
        processItineraryGeneration(jobId, destination, durationDays, database, env.OPENAI_API_KEY)
      );

      // Return immediate response with job ID
      return new Response(JSON.stringify({ jobId }), {
        status: 202,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('Error processing request:', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};