'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Wifi, WifiOff, LogOut, Search, Image as ImageIcon, Paperclip, Loader2, MoreVertical, Edit2, Trash2, Smile, X } from 'lucide-react';
import { ChatClient } from '@/lib/chat-client';
import Auth from '@/components/Auth';
import { supabase } from '@/lib/supabase';
import EmojiPicker from 'emoji-picker-react';

// Utility to parse text and find links/images
const renderContent = (content) => {
  if (!content) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = content.split(urlRegex);

  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      const isImage = part.match(/\.(jpeg|jpg|gif|png|webp)$/i);
      if (isImage) {
        return (
          <img 
            key={i} 
            src={part} 
            alt="attachment" 
            className="max-w-full rounded-lg mt-2 mb-2 shadow-sm border border-gray-700/50"
            onLoad={() => window.scrollTo(0, document.body.scrollHeight)}
          />
        );
      }
      return (
        <a 
          key={i} 
          href={part} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-blue-400 underline break-all hover:text-blue-300"
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const [showEmoji, setShowEmoji] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState(null);
  
  const clientRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
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

  const handleNewMessage = useCallback((msg) => {
    if (msg.type === 'typing') {
      setTypingUsers(prev => ({
        ...prev,
        [msg.sender]: Date.now()
      }));
      return;
    }

    if (msg.type === 'edit') {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content, edited: true } : m));
      return;
    }

    if (msg.type === 'delete') {
      setMessages(prev => prev.filter(m => m.id !== msg.id));
      return;
    }

    setMessages((prev) => {
      if (prev.find(m => m.id === msg.id)) {
        return prev.map(m => m.id === msg.id ? { ...m, ...msg, status: 'sent' } : m);
      }
      return [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
    });
    
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  useEffect(() => {
    if (!session) return;
    clientRef.current = new ChatClient(handleNewMessage, setIsOnline);
    
    // Cleanup typing users every 3 seconds
    const interval = setInterval(() => {
      setTypingUsers(prev => {
        const now = Date.now();
        const next = { ...prev };
        let changed = false;
        for (const user in next) {
          if (now - next[user] > 3000) {
            delete next[user];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 3000);

    return () => {
      if (clientRef.current?.ws) clientRef.current.ws.close();
      if (clientRef.current?.pollInterval) clearInterval(clientRef.current.pollInterval);
      clearInterval(interval);
    };
  }, [session, handleNewMessage]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .or(`username.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(5);

    if (!error) setSearchResults(data || []);
    setIsSearching(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert('File is too large! Please choose an image under 5MB.');
      return;
    }

    setUploading(true);
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `chat/${fileName}`;

    try {
      const { data, error } = await supabase.storage
        .from('chat-attachments')
        .upload(filePath, file);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('chat-attachments')
        .getPublicUrl(filePath);

      const chatData = {
        id: crypto.randomUUID(),
        sender: identity.username,
        color: identity.color,
        content: publicUrl,
        timestamp: Date.now()
      };

      clientRef.current.sendMessage(chatData);
    } catch (error) {
      console.error('Error uploading file:', error.message);
      alert('Failed to upload image.');
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    
    // Typing indicator
    if (clientRef.current && identity) {
      clientRef.current.sendTyping(identity.username);
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    if (editingId) {
      clientRef.current.editMessage(editingId, input.trim());
      setMessages(prev => prev.map(m => m.id === editingId ? { ...m, content: input.trim(), edited: true } : m));
      setEditingId(null);
    } else {
      const chatData = {
        id: crypto.randomUUID(),
        sender: identity.username,
        color: identity.color,
        content: input.trim(),
        timestamp: Date.now()
      };
      clientRef.current.sendMessage(chatData);
    }
    setInput('');
    setShowEmoji(false);
  };

  const startEdit = (msg) => {
    setEditingId(msg.id);
    setInput(msg.content);
    setActiveMenuId(null);
  };

  const deleteMsg = (id) => {
    if (confirm('Delete this message?')) {
      clientRef.current.deleteMessage(id);
      setMessages(prev => prev.filter(m => m.id !== id));
    }
    setActiveMenuId(null);
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

  const typingList = Object.keys(typingUsers).filter(u => u !== identity.username);

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 bg-gray-800/50 backdrop-blur-md border-b border-gray-700/50 sticky top-0 z-20">
        <div className={`${showMobileSearch ? 'hidden' : 'block'} sm:block`}>
          <h1 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            LocalChat
          </h1>
          <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: identity?.color || '#3b82f6' }} />
            {identity?.username || 'User'}
          </p>
        </div>

        {/* Search Bar */}
        <div className={`flex-1 mx-2 sm:mx-8 relative ${showMobileSearch ? 'block' : 'hidden sm:block'}`}>
          <div className="relative flex items-center">
            <Search className="absolute left-3 text-gray-500" size={18} />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full bg-gray-900/50 border border-gray-700 rounded-full py-2 pl-10 pr-10 outline-none focus:border-blue-500 transition-all text-base sm:text-sm"
            />
            {showMobileSearch && (
              <button onClick={() => {setShowMobileSearch(false); setSearchQuery(''); setSearchResults([]);}} className="absolute right-3 text-xs text-gray-400 font-bold">ESC</button>
            )}
          </div>
          {searchQuery.length >= 2 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden z-50 max-h-[60vh] overflow-y-auto text-left">
              {isSearching ? <div className="p-4 text-center text-sm text-gray-400">Searching...</div> : 
               searchResults.length > 0 ? searchResults.map((user) => (
                  <div key={user.id} className="p-3 hover:bg-gray-700/50 flex items-center gap-3 border-b border-gray-700 last:border-0">
                    <span className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: user.color }} />
                    <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{user.username}</p><p className="text-[10px] text-gray-500 truncate">{user.email}</p></div>
                  </div>
                )) : <div className="p-4 text-center text-sm text-gray-400">No users found</div>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {!showMobileSearch && <button onClick={() => setShowMobileSearch(true)} className="sm:hidden p-2 text-gray-400 hover:text-blue-400"><Search size={20} /></button>}
          <div className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-sm font-medium transition-colors ${isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
            {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span className="hidden xs:inline">{isOnline ? 'On' : 'Off'}</span>
          </div>
          <button onClick={handleLogout} className="p-1.5 sm:p-2 text-gray-400 hover:text-rose-400"><LogOut size={18} /></button>
        </div>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
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
              <div className="relative group max-w-[85%] sm:max-w-[70%]">
                <div 
                  className={`px-4 py-2.5 rounded-2xl ${
                    isMe 
                      ? 'bg-blue-600 text-white rounded-br-sm' 
                      : 'bg-gray-800 text-gray-100 rounded-bl-sm border border-gray-700/50'
                  } transition-all duration-200 hover:shadow-lg shadow-black/20`}
                >
                  <div className="leading-relaxed whitespace-pre-wrap break-words text-sm sm:text-base">
                    {renderContent(msg.content)}
                  </div>
                  {(msg.edited || msg.status === 'sent') && (
                    <div className="mt-1 flex items-center justify-end gap-1 opacity-50 text-[10px]">
                      {msg.edited && <span>edited</span>}
                    </div>
                  )}
                </div>

                {/* Actions Menu (My Messages) */}
                {isMe && (
                  <div className="absolute top-0 right-full mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => setActiveMenuId(activeMenuId === msg.id ? null : msg.id)}
                      className="p-1 text-gray-500 hover:text-gray-300"
                    >
                      <MoreVertical size={16} />
                    </button>
                    {activeMenuId === msg.id && (
                      <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-30 py-1 overflow-hidden min-w-[100px]">
                        <button onClick={() => startEdit(msg)} className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-700 flex items-center gap-2"><Edit2 size={12}/> Edit</button>
                        <button onClick={() => deleteMsg(msg.id)} className="w-full px-3 py-1.5 text-left text-xs hover:bg-rose-900/30 text-rose-400 flex items-center gap-2"><Trash2 size={12}/> Delete</button>
                      </div>
                    )}
                  </div>
                )}
                
                {isMe && msg.status === 'pending' && (
                  <span className="absolute -bottom-5 right-1 text-[10px] text-gray-500 italic flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse" />
                    waiting...
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} className="h-2" />
      </main>

      {/* Typing Indicator */}
      {typingList.length > 0 && (
        <div className="px-6 py-1 text-[10px] text-gray-400 italic">
          {typingList.join(', ')} {typingList.length === 1 ? 'is' : 'are'} typing...
        </div>
      )}

      {/* Input Area */}
      <footer className="flex-shrink-0 p-3 sm:p-4 bg-gray-900/80 backdrop-blur-lg border-t border-gray-800 relative">
        {showEmoji && (
          <div className="absolute bottom-full left-0 z-50 p-2">
            <EmojiPicker 
              theme="dark" 
              onEmojiClick={(e) => setInput(prev => prev + e.emoji)}
              width={300}
              height={400}
            />
          </div>
        )}

        <form 
          onSubmit={handleSend} 
          className={`max-w-4xl mx-auto flex items-end gap-1 sm:gap-2 bg-gray-800 rounded-3xl p-1 border transition-all shadow-xl ${editingId ? 'border-amber-500/50 ring-2 ring-amber-500/10' : 'border-gray-700/50 focus-within:border-blue-500/50'}`}
        >
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
          
          <button type="button" onClick={() => setShowEmoji(!showEmoji)} className={`p-2.5 rounded-full transition-colors ${showEmoji ? 'text-blue-400 bg-blue-400/10' : 'text-gray-400 hover:text-blue-400'}`}>
            <Smile size={20} />
          </button>
          
          <button type="button" onClick={() => fileInputRef.current.click()} disabled={uploading} className="p-2.5 text-gray-400 hover:text-blue-400 transition-colors rounded-full">
            {uploading ? <Loader2 className="animate-spin" size={20} /> : <ImageIcon size={20} />}
          </button>
          
          <div className="flex-1 relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              placeholder={editingId ? "Edit message..." : (isOnline ? "Message..." : "Offline...")}
              className="w-full bg-transparent px-2 py-3 outline-none text-gray-100 placeholder:text-gray-500 text-base"
            />
            {editingId && (
              <button onClick={() => {setEditingId(null); setInput('');}} className="p-1 mr-2 text-gray-500 hover:text-gray-300">
                <X size={16} />
              </button>
            )}
          </div>
          
          <button
            type="submit"
            disabled={!input.trim()}
            className={`p-3 m-1 rounded-full transition-colors flex-shrink-0 active:scale-95 shadow-lg ${editingId ? 'bg-amber-500 hover:bg-amber-400 shadow-amber-500/20' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20'}`}
          >
            {editingId ? <Edit2 size={18} /> : <Send size={18} />}
          </button>
        </form>
      </footer>
    </div>
  );
}
