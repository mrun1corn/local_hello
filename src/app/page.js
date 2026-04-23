'use client';

import { useEffect, useState, useRef } from 'react';
import { Send, Wifi, WifiOff, LogOut } from 'lucide-react';
import { ChatClient } from '@/lib/chat-client';
import Auth from '@/components/Auth';
import { supabase } from '@/lib/supabase';

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const clientRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        setIdentity({
          username: session.user.user_metadata.username || 'User',
          color: session.user.user_metadata.color || '#3b82f6'
        });
      }
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        setIdentity({
          username: session.user.user_metadata.username || 'User',
          color: session.user.user_metadata.color || '#3b82f6'
        });
      } else {
        setIdentity(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;

    const handleNewMessage = (msg) => {
      setMessages((prev) => {
        if (prev.find(m => m.id === msg.id)) {
          return prev.map(m => m.id === msg.id ? { ...m, ...msg, status: 'sent' } : m);
        }
        return [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
      });
      
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    };

    clientRef.current = new ChatClient(handleNewMessage, setIsOnline);
    
    return () => {
      if (clientRef.current?.ws) clientRef.current.ws.close();
      if (clientRef.current?.pollInterval) clearInterval(clientRef.current.pollInterval);
    };
  }, [session]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (authLoading) {
    return <div className="h-screen bg-gray-900 flex items-center justify-center text-gray-400">Loading...</div>;
  }

  if (!session) {
    return <Auth onAuthComplete={(user) => {
      setSession({ user });
      setIdentity({
        username: user.user_metadata.username,
        color: user.user_metadata.color
      });
    }} />;
  }

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const chatData = {
      id: crypto.randomUUID(),
      sender: identity.username,
      color: identity.color,
      content: input.trim(),
      timestamp: Date.now()
    };

    clientRef.current.sendMessage(chatData);
    setInput('');
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-gray-800/50 backdrop-blur-md border-b border-gray-700/50 sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            LocalChat
          </h1>
          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
            <span 
              className="inline-block w-2 h-2 rounded-full" 
              style={{ backgroundColor: identity?.color || '#3b82f6' }}
            />
            {identity?.username || 'User'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
          }`}>
            {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
            {isOnline ? 'Connected' : 'Offline Mode'}
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 text-gray-400 hover:text-rose-400 transition-colors"
            title="Sign Out"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {messages.map((msg, idx) => {
          const isMe = msg.sender === identity?.username;
          const showName = !isMe && (idx === 0 || messages[idx - 1].sender !== msg.sender);
          
          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              {showName && (
                <span className="text-xs font-semibold mb-1 ml-1" style={{ color: msg.color }}>
                  {msg.sender}
                </span>
              )}
              <div 
                className={`relative group max-w-[85%] sm:max-w-[70%] px-4 py-2.5 rounded-2xl ${
                  isMe 
                    ? 'bg-blue-600 text-white rounded-br-sm' 
                    : 'bg-gray-800 text-gray-100 rounded-bl-sm border border-gray-700/50'
                } transition-all duration-200 hover:shadow-lg`}
              >
                <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                
                {/* Pending indicator for offline mode */}
                {isMe && msg.status === 'pending' && (
                  <span className="absolute -bottom-5 right-1 text-[10px] text-gray-500 italic flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse" />
                    waiting for connection...
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} className="h-2" />
      </main>

      {/* Input Area */}
      <footer className="flex-shrink-0 p-4 bg-gray-900/80 backdrop-blur-lg border-t border-gray-800">
        <form 
          onSubmit={handleSend} 
          className="max-w-4xl mx-auto flex items-end gap-2 bg-gray-800 rounded-3xl p-1 border border-gray-700/50 focus-within:border-blue-500/50 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isOnline ? "Type a message..." : "Type offline... will send when reconnected"}
            className="flex-1 bg-transparent px-4 py-3 outline-none text-gray-100 placeholder:text-gray-500"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="p-3 m-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-full transition-colors flex-shrink-0"
          >
            <Send size={20} className={input.trim() && isOnline ? "translate-x-0.5 -translate-y-0.5" : ""} />
          </button>
        </form>
      </footer>
    </div>
  );
}
