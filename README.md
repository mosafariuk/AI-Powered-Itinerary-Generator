# AI-Powered Itinerary Generator

A serverless application built with Cloudflare Workers that generates personalized travel itineraries using AI and stores them in Firestore. The API responds instantly with a tracking ID while generating the itinerary asynchronously in the background.

## Architecture Overview

This application follows a modern serverless architecture:

1. **Cloudflare Worker** - Handles HTTP requests and orchestrates the entire flow
2. **LLM Integration** - Uses OpenAI's GPT-4o to generate structured itineraries
3. **Firestore Database** - Stores itinerary data and tracks job status
4. **Asynchronous Processing** - Immediate API response with background generation

### Architectural Decisions

- **Cloudflare Workers**: Chosen for global edge distribution and excellent cold start performance
- **OpenAI GPT-4o**: Reliable structured output generation with good travel knowledge
- **Firebase Admin SDK**: Direct server-to-server communication with Firestore
- **ctx.waitUntil()**: Enables true async processing without blocking the response

## Prerequisites

Before setting up the project, ensure you have:

- Node.js 18+ installed
- A Cloudflare account with Workers enabled
- A Google Cloud Platform account
- An OpenAI API account

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/mosafariuk/AI-Powered-Itinerary-Generator.git
cd ai-itinerary-generator
npm install
```

### 2. Google Cloud Firestore Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Firestore API:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Cloud Firestore API" and enable it
4. Create a Firestore database:
   - Go to "Firestore Database"
   - Click "Create database"
   - Choose "Start in production mode"
   - Select a location close to your users
5. Create a service account:
   - Go to "IAM & Admin" > "Service Accounts"
   - Click "Create Service Account"
   - Name it "itinerary-generator"
   - Grant it "Cloud Datastore User" role
   - Click "Create Key" and download the JSON file

### 3. Configure Firestore Security Rules

In the Google Cloud Console:
1. Go to "Firestore Database" > "Rules"
2. Replace the default rules with the provided security rules
3. Click "Publish"

### 4. Get OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in to your account
3. Navigate to "API Keys"
4. Create a new secret key
5. Copy the key (you won't be able to see it again)

### 5. Set Environment Variables

Set up the required secrets using Wrangler CLI:

```bash
# Install Wrangler globally if you haven't already
npm install -g wrangler

# Login to your Cloudflare account
wrangler login

# Set your OpenAI API key
wrangler secret put OPENAI_API_KEY

# Set your Firebase service account key (paste the entire JSON content)
wrangler secret put FIREBASE_SERVICE_ACCOUNT_KEY
```

For the Firebase service account key, copy the entire content of the JSON file you downloaded earlier.

### 6. Deploy to Cloudflare Workers

```bash
# Deploy to production
npm run deploy

# Or run locally for development
npm run dev
```

## API Usage

### Generate Itinerary

**Endpoint:** `POST /`

**Request Body:**
```json
{
  "destination": "Tokyo, Japan",
  "durationDays": 5
}
```

**Response (202 Accepted):**
```json
{
  "jobId": "123e4567-e89b-12d3-a456-426614174000"
}
```

### Example cURL Request

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Paris, France",
    "durationDays": 3
  }'
```

### Example JavaScript Fetch

```javascript
const response = await fetch('https://your-worker.your-subdomain.workers.dev/', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    destination: 'Barcelona, Spain',
    durationDays: 4
  })
});

const { jobId } = await response.json();
console.log('Job ID:', jobId);
```

## Data Model

The Firestore document structure follows this schema:

```json
{
  "status": "completed" | "processing" | "failed",
  "destination": "Paris, France",
  "durationDays": 3,
  "createdAt": "2025-07-30T10:00:00Z",
  "completedAt": "2025-07-30T10:02:30Z",
  "itinerary": [
    {
      "day": 1,
      "theme": "Historical Paris",
      "activities": [
        {
          "time": "Morning",
          "description": "Visit the Louvre Museum. Pre-book tickets to avoid queues.",
          "location": "Louvre Museum"
        },
        {
          "time": "Afternoon", 
          "description": "Explore the Notre-Dame Cathedral area and walk along the Seine.",
          "location": "Île de la Cité"
        },
        {
          "time": "Evening",
          "description": "Dinner in the Latin Quarter.",
          "location": "Latin Quarter"
        }
      ]
    }
  ],
  "error": null
}
```

## Prompt Engineering Strategy

The LLM prompt is designed to:

1. **Establish Context**: Clearly define the AI's role as a professional travel planner
2. **Specify Structure**: Provide exact JSON schema requirements with examples
3. **Ensure Quality**: Request practical tips, specific locations, and logical activity flow
4. **Constrain Output**: Use system message and explicit instructions for JSON-only responses
5. **Handle Edge Cases**: Include validation for duration limits and destination formats

The prompt balances creativity with structure to generate useful, actionable itineraries.

## Security Considerations

- **API Keys**: Stored as encrypted Cloudflare Workers secrets
- **Firestore Rules**: Read-only access for clients, write access only via Admin SDK
- **Input Validation**: Server-side validation of all user inputs
- **CORS**: Configured to allow cross-origin requests safely
- **Error Handling**: Prevents information leakage in error messages

## Development

### Local Development

```bash
npm run dev
```

This starts a local development server with hot reloading.

### Testing the API

You can test the deployed worker using the examples above, or create a simple HTML file:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Test Itinerary Generator</title>
</head>
<body>
    <script>
        async function testAPI() {
            const response = await fetch('YOUR_WORKER_URL', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destination: 'Rome, Italy',
                    durationDays: 4
                })
            });
            const result = await response.json();
            console.log('Job ID:', result.jobId);
        }
        testAPI();
    </script>
</body>
</html>
```

## Troubleshooting

### Common Issues

1. **Firebase Admin SDK Issues**
   - Ensure `node_compat = true` is set in `wrangler.toml`
   - Verify the service account JSON is properly formatted
   - Check that the Firestore API is enabled in Google Cloud

2. **OpenAI API Errors**
   - Verify your API key is valid and has sufficient credits
   - Check rate limits if requests are failing
   - Ensure the model name is correct (gpt-4o)

3. **CORS Issues**
   - CORS headers are included in all responses
   - Preflight OPTIONS requests are handled

4. **Environment Variables**
   - Use `wrangler secret put` for sensitive data
   - Regular variables go in `wrangler.toml` under `[vars]`

### Logs and Debugging

View logs in real-time:
```bash
wrangler tail
```

Check deployment status:
```bash
wrangler status
```

## Project Structure

```
ai-itinerary-generator/
├── src/
│   └── index.js           # Main Cloudflare Worker code
├── package.json           # Dependencies and scripts
├── wrangler.toml         # Cloudflare Workers configuration
├── firestore.rules       # Firestore security rules
└── README.md             # This file
```

## Next Steps

After deploying the basic application, consider implementing:

1. **Status Checker UI** - Build a Svelte 5 frontend for checking itinerary status
2. **Enhanced Error Handling** - Add retry logic with exponential backoff
3. **Schema Validation** - Use Zod for runtime validation of LLM responses
4. **Rate Limiting** - Implement per-user rate limiting
5. **Caching** - Cache popular destinations to reduce LLM costs

## License

MIT License - see LICENSE file for details.