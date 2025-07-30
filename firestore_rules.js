rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // Allow read access to itineraries collection for anyone with the document ID
    // This enables the status checker functionality
    match /itineraries/{jobId} {
      // Allow read access to anyone (they need the jobId to access)
      allow read: if true;
      
      // Only allow server-side writes (using Firebase Admin SDK)
      // Regular users cannot write to this collection
      allow write: if false;
    }
    
    // Deny access to all other collections
    match /{document=**} {
      allow read, write: if false;
    }
  }
}