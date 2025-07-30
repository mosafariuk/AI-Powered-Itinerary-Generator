import { z } from 'zod';

// Zod schema for itinerary validation
const ActivitySchema = z.object({
  time: z.string().min(1, "Time is required"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  location: z.string().min(1, "Location is required")
});

const DaySchema = z.object({
  day: z.number().int().positive("Day must be a positive integer"),
  theme: z.string().min(1, "Theme is required"),
  activities: z.array(ActivitySchema).min(1, "At least one activity is required per day")
});

const ItinerarySchema = z.array(DaySchema).min(1, "Itinerary must have at least one day");

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffFactor: 2
};

// Generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Sleep function for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate exponential backoff delay
function calculateDelay(attempt) {
  const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffFactor, attempt - 1);
  return Math.min(delay, RETRY_CONFIG.maxDelay);
}

// Enhanced JWT creation
async function createJWT(serviceAccount) {
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  
  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
    
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  
  const privateKeyPem = serviceAccount.private_key
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  
  const privateKeyDer = Uint8Array.from(atob(privateKeyPem), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );
  
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return `${unsignedToken}.${encodedSignature}`;
}

// Get access token with retry logic
async function getAccessToken(serviceAccountKey, attempt = 1) {
  try {
    console.log(`Getting access token (attempt ${attempt}/${RETRY_CONFIG.maxRetries + 1})`);
    const serviceAccount = JSON.parse(serviceAccountKey);
    const jwt = await createJWT(serviceAccount);
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Access token obtained successfully');
    return data.access_token;
  } catch (error) {
    console.error(`Access token attempt ${attempt} failed:`, error);
    
    if (attempt <= RETRY_CONFIG.maxRetries) {
      const delay = calculateDelay(attempt);
      console.log(`Retrying in ${delay}ms...`);
      await sleep(delay);
      return getAccessToken(serviceAccountKey, attempt + 1);
    }
    
    throw new Error(`Failed to get access token after ${RETRY_CONFIG.maxRetries + 1} attempts: ${error.message}`);
  }
}

// Firestore operations with retry logic
async function createFirestoreDocument(projectId, accessToken, collection, docId, data, attempt = 1) {
  try {
    console.log(`Creating Firestore document (attempt ${attempt}/${RETRY_CONFIG.maxRetries + 1}): ${collection}/${docId}`);
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}?documentId=${docId}`;
    
    const firestoreData = {
      status: { stringValue: data.status },
      destination: { stringValue: data.destination },
      durationDays: { integerValue: data.durationDays.toString() },
      createdAt: { timestampValue: data.createdAt.toISOString() },
      completedAt: { nullValue: null },
      itinerary: { nullValue: null },
      error: { nullValue: null }
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: firestoreData }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firestore create failed: ${response.status} - ${errorText}`);
    }
    
    console.log('Firestore document created successfully');
    return await response.json();
  } catch (error) {
    console.error(`Firestore create attempt ${attempt} failed:`, error);
    
    if (attempt <= RETRY_CONFIG.maxRetries && (error.message.includes('500') || error.message.includes('502') || error.message.includes('503'))) {
      const delay = calculateDelay(attempt);
      console.log(`Retrying Firestore create in ${delay}ms...`);
      await sleep(delay);
      return createFirestoreDocument(projectId, accessToken, collection, docId, data, attempt + 1);
    }
    
    throw error;
  }
}

async function updateFirestoreDocument(projectId, accessToken, collection, docId, data, attempt = 1) {
  try {
    console.log(`Updating Firestore document (attempt ${attempt}/${RETRY_CONFIG.maxRetries + 1}): ${collection}/${docId}`);
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${docId}`;
    
    const firestoreData = {
      status: { stringValue: data.status },
      completedAt: { timestampValue: data.completedAt.toISOString() }
    };
    
    if (data.itinerary) {
      const firestoreArray = data.itinerary.map(day => ({
        mapValue: {
          fields: {
            day: { integerValue: day.day.toString() },
            theme: { stringValue: day.theme },
            activities: {
              arrayValue: {
                values: day.activities.map(activity => ({
                  mapValue: {
                    fields: {
                      time: { stringValue: activity.time },
                      description: { stringValue: activity.description },
                      location: { stringValue: activity.location }
                    }
                  }
                }))
              }
            }
          }
        }
      }));
      
      firestoreData.itinerary = { arrayValue: { values: firestoreArray } };
      firestoreData.error = { nullValue: null };
    }
    
    if (data.error) {
      firestoreData.error = { stringValue: data.error };
      firestoreData.itinerary = { nullValue: null };
    }
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: firestoreData }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firestore update failed: ${response.status} - ${errorText}`);
    }
    
    console.log('Firestore document updated successfully');
    return await response.json();
  } catch (error) {
    console.error(`Firestore update attempt ${attempt} failed:`, error);
    
    if (attempt <= RETRY_CONFIG.maxRetries && (error.message.includes('500') || error.message.includes('502') || error.message.includes('503'))) {
      const delay = calculateDelay(attempt);
      console.log(`Retrying Firestore update in ${delay}ms...`);
      await sleep(delay);
      return updateFirestoreDocument(projectId, accessToken, collection, docId, data, attempt + 1);
    }
    
    throw error;
  }
}

// Enhanced LLM prompt
function createItineraryPrompt(destination, durationDays) {
  return `You are a professional travel planner. Create a detailed ${durationDays}-day itinerary for ${destination}.

CRITICAL: Return ONLY a valid JSON array. No markdown formatting, no explanations, no extra text.

Each day must follow this EXACT structure:
{
  "day": 1,
  "theme": "Brief descriptive theme for the day",
  "activities": [
    {
      "time": "Morning",
      "description": "Detailed activity description with practical tips (minimum 20 characters)",
      "location": "Specific location name"
    }
  ]
}

Requirements:
- Include 3-4 activities per day (Morning, Afternoon, Evening, optionally Late Evening)
- Each description must be at least 20 characters long
- Include specific, real location names
- Consider travel time and logical activity flow
- Mix cultural, historical, and leisure activities
- Ensure "day" field matches the day number (1, 2, 3, etc.)

Return ONLY the JSON array starting with [ and ending with ]. No other text.

Destination: ${destination}
Duration: ${durationDays} days`;
}

// Clean and parse OpenAI response
function cleanOpenAIResponse(content) {
  let cleaned = content.trim();
  
  // Remove markdown code blocks
  cleaned = cleaned.replace(/^```json\s*/i, '');
  cleaned = cleaned.replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  
  // Remove any text before the first [
  const startIndex = cleaned.indexOf('[');
  const endIndex = cleaned.lastIndexOf(']');
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    cleaned = cleaned.substring(startIndex, endIndex + 1);
  }
  
  return cleaned.trim();
}

// Generate itinerary with retry logic and validation
async function generateItinerary(destination, durationDays, apiKey, attempt = 1) {
  try {
    console.log(`Calling OpenAI API (attempt ${attempt}/${RETRY_CONFIG.maxRetries + 1})...`);
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
            content: 'You are a professional travel planner. Respond ONLY with valid JSON arrays. No markdown, no explanations, just raw JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 3000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Check for rate limiting
      if (response.status === 429) {
        throw new Error(`Rate limited by OpenAI API: ${errorText}`);
      }
      
      // Check for server errors
      if (response.status >= 500) {
        throw new Error(`OpenAI server error: ${response.status} - ${errorText}`);
      }
      
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    
    console.log('OpenAI response received, cleaning and parsing...');
    console.log('Raw response preview:', content.substring(0, 200) + '...');
    
    // Clean the response
    content = cleanOpenAIResponse(content);
    console.log('Cleaned response preview:', content.substring(0, 200) + '...');
    
    // Parse JSON
    let itinerary;
    try {
      itinerary = JSON.parse(content);
    } catch (parseError) {
      throw new Error(`JSON parsing failed: ${parseError.message}. Content: ${content.substring(0, 500)}`);
    }
    
    // Validate with Zod
    console.log('Validating itinerary structure with Zod...');
    try {
      const validatedItinerary = ItinerarySchema.parse(itinerary);
      
      // Additional validation
      if (validatedItinerary.length !== durationDays) {
        throw new Error(`Expected ${durationDays} days, got ${validatedItinerary.length} days`);
      }
      
      // Validate day sequence
      for (let i = 0; i < validatedItinerary.length; i++) {
        if (validatedItinerary[i].day !== i + 1) {
          throw new Error(`Day sequence error: expected day ${i + 1}, got day ${validatedItinerary[i].day}`);
        }
      }
      
      console.log(`Successfully validated itinerary with ${validatedItinerary.length} days`);
      return validatedItinerary;
      
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errors = validationError.errors.map(err => `${err.path.join('.')}: ${err.message}`).join('; ');
        throw new Error(`Validation failed: ${errors}`);
      }
      throw validationError;
    }
    
  } catch (error) {
    console.error(`Itinerary generation attempt ${attempt} failed:`, error);
    
    // Retry for certain types of errors
    const isRetryableError = 
      error.message.includes('Rate limited') ||
      error.message.includes('server error') ||
      error.message.includes('500') ||
      error.message.includes('502') ||
      error.message.includes('503') ||
      error.message.includes('timeout');
    
    if (attempt <= RETRY_CONFIG.maxRetries && isRetryableError) {
      const delay = calculateDelay(attempt);
      console.log(`Retrying OpenAI API call in ${delay}ms...`);
      await sleep(delay);
      return generateItinerary(destination, durationDays, apiKey, attempt + 1);
    }
    
    throw new Error(`Failed to generate itinerary after ${attempt} attempts: ${error.message}`);
  }
}

// Enhanced async processing
async function processItineraryGeneration(jobId, destination, durationDays, serviceAccountKey, openaiApiKey) {
  let accessToken = null;
  let serviceAccount = null;
  let projectId = null;

  try {
    console.log(`Starting enhanced itinerary generation for job ${jobId}`);
    
    // Parse service account
    serviceAccount = JSON.parse(serviceAccountKey);
    projectId = serviceAccount.project_id;
    
    // Get access token with retry
    accessToken = await getAccessToken(serviceAccountKey);
    
    // Generate itinerary with validation and retry
    const itinerary = await generateItinerary(destination, durationDays, openaiApiKey);
    
    // Update Firestore with success
    await updateFirestoreDocument(projectId, accessToken, 'itineraries', jobId, {
      status: 'completed',
      itinerary: itinerary,
      completedAt: new Date(),
      error: null
    });
    
    console.log(`✅ Itinerary generation completed successfully for job ${jobId}`);
    
  } catch (error) {
    console.error(`❌ Error generating itinerary for job ${jobId}:`, error);
    
    // Attempt to update Firestore with error status
    try {
      if (!accessToken && serviceAccount) {
        accessToken = await getAccessToken(serviceAccountKey);
      }
      
      if (accessToken && projectId) {
        await updateFirestoreDocument(projectId, accessToken, 'itineraries', jobId, {
          status: 'failed',
          completedAt: new Date(),
          error: `Generation failed: ${error.message}`,
          itinerary: null
        });
        console.log(`Updated job ${jobId} status to failed`);
      }
    } catch (updateError) {
      console.error(`Failed to update error status for job ${jobId}:`, updateError);
    }
  }
}

// Helper function to convert Firestore format
function convertFromFirestoreFormat(fields) {
  const result = {};
  
  for (const [key, value] of Object.entries(fields)) {
    if (value.stringValue !== undefined) {
      result[key] = value.stringValue;
    } else if (value.integerValue !== undefined) {
      result[key] = parseInt(value.integerValue);
    } else if (value.timestampValue !== undefined) {
      result[key] = value.timestampValue;
    } else if (value.nullValue !== undefined) {
      result[key] = null;
    } else if (value.arrayValue !== undefined) {
      result[key] = value.arrayValue.values.map(item => {
        if (item.mapValue) {
          return convertFromFirestoreFormat(item.mapValue.fields);
        }
        return convertFromFirestoreFormat({ temp: item }).temp;
      });
    } else if (value.mapValue !== undefined) {
      result[key] = convertFromFirestoreFormat(value.mapValue.fields);
    }
  }
  
  return result;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    
    // GET endpoint for status checking
    if (request.method === 'GET') {
      const jobId = url.searchParams.get('jobId') || url.pathname.split('/').pop();
      
      if (!jobId || jobId === '' || jobId === '/') {
        return new Response(JSON.stringify({ 
          error: 'jobId is required',
          usage: 'GET /?jobId=YOUR_JOB_ID'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      try {
        if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) {
          throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not configured');
        }
        
        const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
        const accessToken = await getAccessToken(env.FIREBASE_SERVICE_ACCOUNT_KEY);
        
        const response = await fetch(
          `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents/itineraries/${jobId}`,
          {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          }
        );
        
        if (response.status === 404) {
          return new Response(JSON.stringify({ error: 'Job not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        if (!response.ok) {
          throw new Error(`Firestore error: ${response.status}`);
        }
        
        const doc = await response.json();
        const data = convertFromFirestoreFormat(doc.fields);
        
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        console.error('Status check error:', error);
        return new Response(JSON.stringify({ 
          error: 'Failed to check status',
          details: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST endpoint for creating itineraries
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders 
      });
    }

    try {
      console.log('🚀 Processing new enhanced itinerary request...');
      
      const body = await request.json();
      const { destination, durationDays } = body;

      // Enhanced input validation
      if (!destination || typeof destination !== 'string' || destination.trim().length < 2) {
        return new Response(JSON.stringify({ 
          error: 'destination is required and must be at least 2 characters long' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (!durationDays || typeof durationDays !== 'number' || 
          durationDays < 1 || durationDays > 30 || !Number.isInteger(durationDays)) {
        return new Response(JSON.stringify({ 
          error: 'durationDays must be an integer between 1 and 30' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Check environment variables
      if (!env.FIREBASE_SERVICE_ACCOUNT_KEY || !env.OPENAI_API_KEY) {
        throw new Error('Required environment variables not configured');
      }

      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
      const projectId = serviceAccount.project_id;
      
      console.log(`📍 Destination: ${destination}, Duration: ${durationDays} days`);

      // Get access token
      const accessToken = await getAccessToken(env.FIREBASE_SERVICE_ACCOUNT_KEY);
      const jobId = generateUUID();
      
      console.log(`🎯 Generated job ID: ${jobId}`);

      // Create initial document
      await createFirestoreDocument(projectId, accessToken, 'itineraries', jobId, {
        status: 'processing',
        destination: destination.trim(),
        durationDays: durationDays,
        createdAt: new Date(),
        completedAt: null,
        itinerary: null,
        error: null
      });

      // Start enhanced async processing
      ctx.waitUntil(
        processItineraryGeneration(
          jobId, 
          destination.trim(), 
          durationDays, 
          env.FIREBASE_SERVICE_ACCOUNT_KEY, 
          env.OPENAI_API_KEY
        )
      );

      console.log(`✅ Request processed successfully, job ${jobId} started`);
      
      return new Response(JSON.stringify({ 
        jobId,
        message: 'Itinerary generation started with enhanced processing'
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('❌ Request processing error:', error);
      
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: 'Failed to process request with enhanced error handling',
        details: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};