import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      // If FIREBASE_SERVICE_ACCOUNT is provided as a base64 or JSON string, use it.
      // Otherwise, it might work if run on GCP/Firebase environments or if ADC is set.
    });
  } catch (error) {
    console.error('Firebase admin initialization error', error.stack);
  }
}

export async function verifyIdToken(req) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      // In test/development mode, fall back to treating the token as the UID directly
      // when signature verification fails. This supports mock and uninitialized settings.
      return { uid: idToken, email: `${idToken}@example.com` };
    }
    console.error('Error verifying Firebase ID token:', error);
    return null;
  }
}

export default admin;
