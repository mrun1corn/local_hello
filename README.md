# LocalChat

A hybrid, self-hosted chat application built with Next.js, Firebase, and SQLite.

## Features

- **Real-time Messaging**: Powered by Firebase Firestore for seamless, instant synchronization.
- **Email Verification**: Secure authentication using Firebase Auth with mandatory email verification.
- **Local Data Storage**: User profiles and connections are mirrored in a local `better-sqlite3` database for high-performance access.
- **Local Image Uploads**: Images are uploaded and served directly from your server's disk, bypassing cloud storage costs.
- **Discovery**: Bonjour/mDNS support for local network discovery.
- **Background Hosting**: Ready for production deployment with PM2.

## Prerequisites

- Node.js (v18 or higher)
- A Firebase Project with **Email/Password Auth** and **Cloud Firestore** enabled.

## Setup Instructions

1.  **Clone and Install**:
    ```bash
    git clone <your-repo-url>
    cd local_hello
    npm install
    ```

2.  **Environment Configuration**:
    Create a `.env` file in the root directory (refer to your Firebase Console for these values):
    ```env
    NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
    NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
    PORT=3000
    ```

3.  **Firebase Rules**:
    In your Firebase Console, ensure your Firestore rules allow authenticated access:
    ```javascript
    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        match /{document=**} {
          allow read, write: if request.auth != null;
        }
      }
    }
    ```

## Deployment with PM2

To run the application in the background on your server:

1.  **Build the application**:
    ```bash
    npm run build
    ```

2.  **Start with PM2**:
    ```bash
    pm2 start ecosystem.config.js
    ```

3.  **Manage the process**:
    ```bash
    pm2 status
    pm2 logs local-hello
    ```

## Development

To run the app locally with hot-reloading:
```bash
npm run dev:local
```

## License
MIT
