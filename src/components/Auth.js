'use client';

import { useState } from 'react';
import { User, Loader2 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import toast, { Toaster } from 'react-hot-toast';
import { 
  GoogleAuthProvider,
  signInWithPopup,
  getAdditionalUserInfo,
  updateProfile,
  signOut
} from 'firebase/auth';

export default function Auth({ onAuthComplete }) {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [setupUser, setSetupUser] = useState(null); // Set when a new user needs to pick a username

  const syncProfile = async (firebaseUser, displayName) => {
    // Sync Firebase user to local SQLite profiles table
    await fetch('/api/profiles/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: firebaseUser.uid,
        email: firebaseUser.email,
        username: displayName || firebaseUser.displayName || firebaseUser.email.split('@')[0],
      })
    });
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      const user = userCredential.user;

      // Check if they have a local profile
      const res = await fetch(`/api/profiles/me?id=${user.uid}`);
      const { data } = await res.json();

      // If they don't have a local profile, ask for a username
      if (!data) {
        setSetupUser(user);
      } else {
        // Returning user
        onAuthComplete(user);
      }
    } catch (err) {
      console.warn('Google Auth failed:', err.message);
      toast.error(err.message.replace('Firebase: ', '').split(' (auth/')[0].trim());
    } finally {
      setLoading(false);
    }
  };

  const handleSetUsername = async (e) => {
    e.preventDefault();
    if (!username.trim() || !setupUser) return;
    
    setLoading(true);
    try {
      await updateProfile(setupUser, { displayName: username.trim() });
      await syncProfile(setupUser, username.trim());
      onAuthComplete(setupUser);
    } catch (err) {
      console.error(err);
      toast.error("Failed to set username. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSetup = () => {
    signOut(auth);
    setSetupUser(null);
    setUsername('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <Toaster />
      <div className="w-full max-w-md bg-gray-800 rounded-3xl p-8 border border-gray-700 shadow-2xl">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            {setupUser ? 'Welcome to LocalChat' : 'Join LocalChat'}
          </h2>
          <p className="text-gray-400 mt-2">
            {setupUser ? 'Choose a username to get started' : 'Sign in securely with your Google account'}
          </p>
        </div>

        {setupUser ? (
          <form onSubmit={handleSetUsername} className="space-y-4">
            <div className="relative">
              <User className="absolute left-3 top-3.5 text-gray-500" size={18} />
              <input
                type="text"
                placeholder="Choose a Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 pl-10 pr-4 outline-none focus:border-blue-500 transition-colors text-white"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !username.trim()}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : 'Complete Setup'}
            </button>
            
            <button
              type="button"
              onClick={handleCancelSetup}
              className="w-full text-gray-500 hover:text-rose-400 text-sm py-2 transition-all"
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full bg-white hover:bg-gray-100 text-gray-900 font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                    <path d="M1 1h22v22H1z" fill="none" />
                  </svg>
                  Sign in with Google
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}