// Generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Simple JWT creation using Google's method
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
  
  // Encode header and payload
  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
    
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  
  // Clean and import the private key
  const privateKeyPem = serviceAccount.private_key
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  
  // Convert base64 to ArrayBuffer
  const privateKeyDer = Uint8Array.from(atob(privateKeyPem), c => c.charCodeAt(0));
  
  // Import the private key
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
  
  // Sign the token
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );
  
  // Encode signature
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return `${unsignedToken}.${encodedSignature}`;
}

// Get access token
async function getAccessToken(serviceAccountKey) {
  try {
    console.log('Parsing service account...');
    const serviceAccount = JSON.parse(serviceAccountKey);
    
    console.log('Creating JWT...');
    const jwt = await createJWT(serviceAccount);
    
    console.log('Exchanging JWT for access token...');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
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
    console.error('Error getting access token:', error);
    throw error;
  }
}

// Get Firestore document
async function getFirestoreDocument(projectId, accessToken, collection, docId) {
  try {
    console.log(`Getting Firestore document: ${collection}/${docId}`);
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${docId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return null; // Document not found
      }
      const errorText = await response.text();
      throw new Error(`Firestore get failed: ${response.status} - ${errorText}`);
    }
    
    const doc = await response.json();
    console.log('Firestore document retrieved successfully');
    
    // Convert from Firestore format to regular format
    return convertFromFirestoreFormat(doc.fields);
  } catch (error) {
    console.error('Error getting Firestore document:', error);
    throw error;
  }
}

// Convert from Firestore format to regular JSON
function convertFromFirestoreFormat(fields) {
  const result = {};
  
  for (const [key, value] of Object.entries(fields)) {
    if (value.stringValue !== undefined) {
      result[key] = value.stringValue;
    } else if (value.integerValue !== undefined) {
      result[key] = parseInt(value.integerValue);
    } else if (value.booleanValue !== undefined) {
      result[key] = value.booleanValue;
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

// Simplified Firestore operations
async function createFirestoreDocument(projectId, accessToken, collection, docId, data) {
  try {
    console.log(`Creating Firestore document: ${collection}/${docId}`);
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}?documentId=${docId}`;
    
    // Convert to Firestore format
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
    console.error('Error creating Firestore document:', error);
    throw error;
  }
}

// Update Firestore document
async function updateFirestoreDocument(projectId, accessToken, collection, docId, data) {
  try {
    console.log(`Updating Firestore document: ${collection}/${docId}`);
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${docId}`;
    
    // Convert to Firestore format
    const firestoreData = {
      status: { stringValue: data.status },
      completedAt: { timestampValue: data.completedAt.toISOString() }
    };
    
    if (data.itinerary) {
      // Convert array to Firestore array format
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
    console.error('Error updating Firestore document:', error);
    throw error;
  }
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
      "time": "Morning",
      "description": "Detailed activity description with practical tips",
      "location": "Specific location name"
    }
  ]
}

Requirements:
- Include 3-4 activities per day (Morning, Afternoon, Evening)
- Provide practical, actionable descriptions
- Include specific location names
- Consider travel time between locations
- Mix cultural, historical, and leisure activities
- Return ONLY the JSON array, no other text

Destination: ${destination}
Duration: ${durationDays} days`;
}

// Clean OpenAI response to extract JSON
function cleanOpenAIResponse(content) {
  // Remove markdown code blocks if present
  let cleaned = content.trim();
  
  // Remove ```json and ``` markers
  cleaned = cleaned.replace(/^```json\s*/i, '');
  cleaned = cleaned.replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  
  // Remove any leading/trailing whitespace
  cleaned = cleaned.trim();
  
  // Find JSON array start and end
  const startIndex = cleaned.indexOf('[');
  const endIndex = cleaned.lastIndexOf(']');
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    cleaned = cleaned.substring(startIndex, endIndex + 1);
  }
  
  return cleaned;
}

// Call OpenAI API
async function generateItinerary(destination, durationDays, apiKey) {
  try {
    console.log('Calling OpenAI API...');
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
            content: 'You are a professional travel planner. Respond with a valid JSON array only, no markdown formatting, no explanations, just the raw JSON array.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    
    console.log('OpenAI response received, cleaning and parsing JSON...');
    console.log('Raw response preview:', content.substring(0, 200) + '...');
    
    // Clean the response to extract pure JSON
    content = cleanOpenAIResponse(content);
    console.log('Cleaned response preview:', content.substring(0, 200) + '...');
    
    // Parse the cleaned JSON
    const itinerary = JSON.parse(content);
    
    // Validate the structure
    if (!Array.isArray(itinerary)) {
      throw new Error('Response is not an array');
    }
    
    if (itinerary.length === 0) {
      throw new Error('Empty itinerary received');
    }
    
    // Validate each day has required fields
    for (const day of itinerary) {
      if (!day.day || !day.theme || !Array.isArray(day.activities)) {
        throw new Error(`Invalid day structure: ${JSON.stringify(day)}`);
      }
    }
    
    console.log(`Successfully parsed itinerary with ${itinerary.length} days`);
    return itinerary;
    
  } catch (error) {
    console.error('Error generating itinerary:', error);
    console.error('Error details:', error.message);
    throw error;
  }
}

// Process itinerary generation asynchronously
async function processItineraryGeneration(jobId, destination, durationDays, serviceAccountKey, openaiApiKey) {
  try {
    console.log(`Starting itinerary generation for job ${jobId}`);
    
    // Parse service account to get project ID
    const serviceAccount = JSON.parse(serviceAccountKey);
    const projectId = serviceAccount.project_id;
    
    // Get access token
    const accessToken = await getAccessToken(serviceAccountKey);
    
    // Generate itinerary using LLM
    const itinerary = await generateItinerary(destination, durationDays, openaiApiKey);
    
    // Update Firestore document with completed itinerary
    await updateFirestoreDocument(projectId, accessToken, 'itineraries', jobId, {
      status: 'completed',
      itinerary: itinerary,
      completedAt: new Date(),
      error: null
    });
    
    console.log(`Itinerary generation completed for job ${jobId}`);
  } catch (error) {
    console.error(`Error generating itinerary for job ${jobId}:`, error);
    
    try {
      // Update Firestore document with error status
      const serviceAccount = JSON.parse(serviceAccountKey);
      const accessToken = await getAccessToken(serviceAccountKey);
      
      await updateFirestoreDocument(serviceAccount.project_id, accessToken, 'itineraries', jobId, {
        status: 'failed',
        completedAt: new Date(),
        error: error.message
      });
    } catch (updateError) {
      console.error(`Failed to update error status for job ${jobId}:`, updateError);
    }
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

    const url = new URL(request.url);
    
    // GET endpoint for checking status
    if (request.method === 'GET') {
      const jobId = url.searchParams.get('jobId') || url.pathname.split('/').pop();
      
      if (!jobId || jobId === '' || jobId === '/') {
        return new Response(JSON.stringify({ 
          error: 'jobId is required',
          usage: 'GET /?jobId=YOUR_JOB_ID or GET /YOUR_JOB_ID'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      try {
        console.log(`Checking status for job: ${jobId}`);
        
        // Check environment variables
        if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) {
          throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable not set');
        }
        
        // Parse service account to get project ID
        const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
        const projectId = serviceAccount.project_id;
        
        // Get access token for Firestore
        const accessToken = await getAccessToken(env.FIREBASE_SERVICE_ACCOUNT_KEY);
        
        // Get document from Firestore
        const document = await getFirestoreDocument(projectId, accessToken, 'itineraries', jobId);
        
        if (!document) {
          return new Response(JSON.stringify({ error: 'Job not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        console.log(`Status check completed for job ${jobId}: ${document.status}`);
        
        return new Response(JSON.stringify(document), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        console.error('Error checking status:', error);
        return new Response(JSON.stringify({ 
          error: 'Failed to check status',
          details: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // POST endpoint for creating itineraries (existing functionality)
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders 
      });
    }

    try {
      console.log('Processing new request...');
      
      // Parse request body
      const body = await request.json();
      const { destination, durationDays } = body;
      
      console.log(`Request: destination=${destination}, durationDays=${durationDays}`);

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

      // Check environment variables
      if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable not set');
      }
      
      if (!env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable not set');
      }

      // Parse service account to get project ID
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
      const projectId = serviceAccount.project_id;
      
      console.log(`Using project ID: ${projectId}`);

      // Get access token for Firestore
      const accessToken = await getAccessToken(env.FIREBASE_SERVICE_ACCOUNT_KEY);

      // Generate unique job ID
      const jobId = generateUUID();
      console.log(`Generated job ID: ${jobId}`);

      // Create initial document in Firestore
      await createFirestoreDocument(projectId, accessToken, 'itineraries', jobId, {
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
        processItineraryGeneration(
          jobId, 
          destination, 
          durationDays, 
          env.FIREBASE_SERVICE_ACCOUNT_KEY, 
          env.OPENAI_API_KEY
        )
      );

      console.log('Returning job ID to client');
      
      // Return immediate response with job ID
      return new Response(JSON.stringify({ jobId }), {
        status: 202,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('Error processing request:', error);
      console.error('Error stack:', error.stack);
      
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        details: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};