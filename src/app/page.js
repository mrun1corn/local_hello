'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Wifi, WifiOff, LogOut, Search, Image as ImageIcon, Loader2, MoreVertical, Edit2, Trash2, Smile, X, UserPlus, Check, MessageSquare, Users } from 'lucide-react';
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
        return <img key={i} src={part} alt="attachment" className="max-w-full rounded-lg mt-2 mb-2 shadow-sm border border-gray-700/50" onLoad={() => window.scrollTo(0, document.body.scrollHeight)} />;
      }
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline break-all hover:text-blue-300">{part}</a>;
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
  
  // Contacts & Connections
  const [contacts, setContacts] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  
  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Message States
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const [showEmoji, setShowEmoji] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState(null);
  
  const clientRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // 1. Initial Load & Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        setIdentity({
          id: session.user.id,
          username: session.user.user_metadata.username || 'User',
          color: session.user.user_metadata.color || '#3b82f6'
        });
        loadConnections(session.user.id);
      }
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        setIdentity({
          id: session.user.id,
          username: session.user.user_metadata.username || 'User',
          color: session.user.user_metadata.color || '#3b82f6'
        });
        loadConnections(session.user.id);
      } else {
        setIdentity(null);
        setContacts([]);
        setPendingRequests([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. Load Connections
  const loadConnections = async (userId) => {
    // Get accepted contacts
    const { data: accepted } = await supabase
      .from('connections')
      .select('*, profiles!connections_receiver_id_fkey(*), profiles!connections_sender_id_fkey(*)')
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq('status', 'accepted');

    if (accepted) {
      const formatted = accepted.map(c => {
        const other = c.sender_id === userId ? c.profiles!connections_receiver_id_fkey : c.profiles!connections_sender_id_fkey;
        return { ...other, connection_id: c.id };
      });
      setContacts(formatted);
    }

    // Get pending requests (received)
    const { data: pending } = await supabase
      .from('connections')
      .select('*, profiles!connections_sender_id_fkey(*)')
      .eq('receiver_id', userId)
      .eq('status', 'pending');
    
    if (pending) {
      setPendingRequests(pending.map(p => ({ ...p.profiles!connections_sender_id_fkey, request_id: p.id })));
    }
  };

  // 3. Message Handling
  const handleNewMessage = useCallback((msg) => {
    if (msg.type === 'typing') {
      if (msg.receiver_id === identity?.id) {
        setTypingUsers(prev => ({ ...prev, [msg.sender]: Date.now() }));
      }
      return;
    }

    // Filter messages for current active conversation
    if (msg.type === 'edit') {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content, edited: true } : m));
    } else if (msg.type === 'delete') {
      setMessages(prev => prev.filter(m => m.id !== msg.id));
    } else {
      // Only add message if it belongs to active chat
      const isFromActive = activeContact && (msg.sender_id === activeContact.id || msg.receiver_id === activeContact.id);
      const isGlobal = !msg.receiver_id; // Support global if needed
      
      if (isFromActive || isGlobal) {
        setMessages((prev) => {
          if (prev.find(m => m.id === msg.id)) {
            return prev.map(m => m.id === msg.id ? { ...m, ...msg, status: 'sent' } : m);
          }
          return [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
        });
      }
    }
    
    setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 100);
  }, [activeContact, identity]);

  // 4. Initialize Client when Active Contact Changes
  useEffect(() => {
    if (!session || !identity) return;
    clientRef.current = new ChatClient(identity.id, handleNewMessage, setIsOnline);
    
    // Load history for active contact
    if (activeContact) {
      setMessages([]);
      supabase.from('messages')
        .select('*')
        .or(`and(sender_id.eq.${identity.id},receiver_id.eq.${activeContact.id}),and(sender_id.eq.${activeContact.id},receiver_id.eq.${identity.id})`)
        .order('timestamp', { ascending: true })
        .then(({ data }) => { if (data) setMessages(data); });
    }

    return () => {
      if (clientRef.current?.ws) clientRef.current.ws.close();
      if (clientRef.current?.pollInterval) clearInterval(clientRef.current.pollInterval);
    };
  }, [session, identity, activeContact, handleNewMessage]);

  // 5. Connection Actions
  const sendRequest = async (user) => {
    const { error } = await supabase
      .from('connections')
      .insert([{ sender_id: identity.id, receiver_id: user.id, status: 'pending' }]);
    
    if (error) alert(error.message);
    else {
      alert('Request sent!');
      setSearchQuery('');
    }
  };

  const acceptRequest = async (request) => {
    const { error } = await supabase
      .from('connections')
      .update({ status: 'accepted' })
      .eq('id', request.request_id);
    
    if (!error) {
      setPendingRequests(prev => prev.filter(r => r.request_id !== request.request_id));
      loadConnections(identity.id);
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim() || !activeContact) return;

    const chatData = {
      id: crypto.randomUUID(),
      sender: identity.username,
      sender_id: identity.id,
      receiver_id: activeContact.id,
      color: identity.color,
      content: input.trim(),
      timestamp: Date.now()
    };

    if (editingId) {
      clientRef.current.editMessage(editingId, activeContact.id, input.trim());
      setMessages(prev => prev.map(m => m.id === editingId ? { ...m, content: input.trim(), edited: true } : m));
      setEditingId(null);
    } else {
      clientRef.current.sendMessage(chatData);
    }
    setInput('');
    setShowEmoji(false);
  };

  // UI Handlers
  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    setIsSearching(true);
    const { data } = await supabase.from('profiles').select('*').or(`username.ilike.%${query}%,email.ilike.%${query}%`).neq('id', identity.id).limit(5);
    setSearchResults(data || []);
    setIsSearching(false);
  };

  if (authLoading) return <div className="h-screen bg-gray-900 flex items-center justify-center text-gray-400">Loading...</div>;
  if (!session) return <Auth onAuthComplete={() => window.location.reload()} />;

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans selection:bg-blue-500/30 overflow-hidden">
      
      {/* Sidebar */}
      <aside className={`${showSidebar ? 'w-full sm:w-80' : 'w-0'} bg-gray-800/50 border-r border-gray-700/50 flex flex-col transition-all overflow-hidden z-30`}>
        <div className="p-4 border-b border-gray-700/50 flex items-center justify-between">
           <h2 className="font-bold flex items-center gap-2"><Users size={20}/> People</h2>
           <button onClick={() => setShowSidebar(false)} className="sm:hidden text-gray-400"><X/></button>
        </div>
        
        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
            <input 
              type="text" 
              placeholder="Search users..." 
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg py-2 pl-9 pr-4 text-sm outline-none focus:border-blue-500" 
            />
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-50">
                {searchResults.map(user => (
                  <div key={user.id} className="p-3 hover:bg-gray-700 flex items-center justify-between gap-2 border-b border-gray-700 last:border-0">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-6 h-6 rounded-full" style={{ backgroundColor: user.color }} />
                      <span className="text-sm truncate">{user.username}</span>
                    </div>
                    <button onClick={() => sendRequest(user)} className="p-1.5 bg-blue-600 rounded-md hover:bg-blue-500"><UserPlus size={14}/></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {pendingRequests.length > 0 && (
            <div className="p-4">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Pending Requests</p>
              {pendingRequests.map(r => (
                <div key={r.id} className="flex items-center justify-between bg-blue-500/5 p-2 rounded-lg mb-2">
                  <span className="text-sm truncate">{r.username}</span>
                  <button onClick={() => acceptRequest(r)} className="p-1 bg-emerald-600 rounded hover:bg-emerald-500"><Check size={14}/></button>
                </div>
              ))}
            </div>
          )}

          <div className="p-4">
             <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Connections</p>
             {contacts.map(c => (
               <button 
                key={c.id} 
                onClick={() => { setActiveContact(c); if(window.innerWidth < 640) setShowSidebar(false); }}
                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all mb-1 ${activeContact?.id === c.id ? 'bg-blue-600 shadow-lg' : 'hover:bg-gray-700/50'}`}
               >
                 <span className="w-10 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                 <div className="text-left overflow-hidden">
                    <p className="text-sm font-semibold truncate">{c.username}</p>
                    <p className="text-xs text-gray-400 truncate">Click to chat</p>
                 </div>
               </button>
             ))}
          </div>
        </div>

        <div className="p-4 border-t border-gray-700/50 flex items-center justify-between">
           <div className="flex items-center gap-2 truncate">
              <span className="w-8 h-8 rounded-full" style={{ backgroundColor: identity?.color }} />
              <span className="text-sm font-medium truncate">{identity?.username}</span>
           </div>
           <button onClick={handleLogout} className="text-gray-400 hover:text-rose-400"><LogOut size={18}/></button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex-shrink-0 border-b border-gray-700/50 bg-gray-800/30 flex items-center justify-between px-4 sm:px-6">
           <div className="flex items-center gap-3">
              <button onClick={() => setShowSidebar(true)} className="sm:hidden text-gray-400 mr-2"><MessageSquare size={20}/></button>
              {activeContact ? (
                <>
                  <span className="w-8 h-8 rounded-full" style={{ backgroundColor: activeContact.color }} />
                  <div>
                    <h3 className="font-bold text-sm">{activeContact.username}</h3>
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      online
                    </div>
                  </div>
                </>
              ) : (
                <h3 className="font-bold text-gray-400 italic">Select a contact to start chatting</h3>
              )}
           </div>
           <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              <Wifi size={14} /> {isOnline ? 'Network Active' : 'Offline'}
           </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {messages.map((msg, idx) => {
            const isMe = msg.sender_id === identity?.id;
            const showName = !isMe && (idx === 0 || messages[idx - 1].sender_id !== msg.sender_id);
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {showName && <span className="text-[10px] font-bold mb-1 opacity-50" style={{ color: msg.color }}>{msg.sender}</span>}
                <div className="relative group max-w-[85%] sm:max-w-[70%]">
                  <div className={`px-4 py-2.5 rounded-2xl ${isMe ? 'bg-blue-600 text-white rounded-br-sm shadow-blue-900/20' : 'bg-gray-800 text-gray-100 rounded-bl-sm border border-gray-700/50 shadow-black/20'} shadow-lg`}>
                    <div className="leading-relaxed whitespace-pre-wrap break-words text-sm sm:text-base">{renderContent(msg.content)}</div>
                    {msg.edited && <div className="text-[9px] opacity-40 mt-1 text-right italic">edited</div>}
                  </div>
                  {isMe && (
                    <div className="absolute top-0 right-full mr-2 opacity-0 group-hover:opacity-100 transition-opacity flex">
                      <button onClick={() => setActiveMenuId(activeMenuId === msg.id ? null : msg.id)} className="p-1 text-gray-500 hover:text-gray-300"><MoreVertical size={16}/></button>
                      {activeMenuId === msg.id && (
                        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-30 py-1 overflow-hidden min-w-[100px]">
                          <button onClick={() => { setEditingId(msg.id); setInput(msg.content); setActiveMenuId(null); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-700 flex items-center gap-2"><Edit2 size={12}/> Edit</button>
                          <button onClick={() => { if(confirm('Delete?')) { clientRef.current.deleteMessage(msg.id, activeContact.id); setMessages(prev => prev.filter(m => m.id !== msg.id)); } setActiveMenuId(null); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-rose-900/30 text-rose-400 flex items-center gap-2"><Trash2 size={12}/> Delete</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} className="h-4" />
        </div>

        {/* Typing Area */}
        <div className="h-6 px-6 text-[10px] text-gray-500 italic">
          {Object.keys(typingUsers).filter(u => u !== identity?.username).join(', ')} typing...
        </div>

        <footer className="p-3 sm:p-4 bg-gray-900/80 backdrop-blur-lg border-t border-gray-800 relative">
          {showEmoji && <div className="absolute bottom-full left-0 z-50 p-2"><EmojiPicker theme="dark" onEmojiClick={(e) => setInput(prev => prev + e.emoji)} width={300} height={400}/></div>}
          <form onSubmit={handleSend} className={`max-w-4xl mx-auto flex items-end gap-1 sm:gap-2 bg-gray-800 rounded-3xl p-1 border transition-all ${!activeContact ? 'opacity-50 pointer-events-none' : 'border-gray-700'}`}>
             <button type="button" onClick={() => setShowEmoji(!showEmoji)} className="p-2.5 text-gray-400 hover:text-blue-400"><Smile size={20}/></button>
             <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
             <button type="button" onClick={() => fileInputRef.current.click()} disabled={uploading} className="p-2.5 text-gray-400 hover:text-blue-400">
               {uploading ? <Loader2 className="animate-spin" size={20}/> : <ImageIcon size={20}/>}
             </button>
             <input type="text" value={input} onChange={(e) => { setInput(e.target.value); clientRef.current.sendTyping(identity.username, activeContact.id); }} placeholder={editingId ? "Edit..." : "Message..."} className="flex-1 bg-transparent px-2 py-3 outline-none text-gray-100 text-base" />
             <button type="submit" disabled={!input.trim()} className={`p-3 m-1 rounded-full transition-colors ${editingId ? 'bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'}`}>
                {editingId ? <Edit2 size={18}/> : <Send size={18}/>}
             </button>
          </form>
        </footer>
      </main>
    </div>
  );
}
