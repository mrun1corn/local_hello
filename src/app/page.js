'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Wifi, WifiOff, LogOut, Search, Image as ImageIcon, Loader2, MoreVertical, Edit2, Trash2, Smile, X, UserPlus, Check, MessageSquare, Users, Inbox } from 'lucide-react';
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
  const [messageRequests, setMessageRequests] = useState([]);
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
        setMessageRequests([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. Load Connections & Requests
  const loadConnections = async (userId) => {
    // Get accepted contacts
    const { data: accepted } = await supabase
      .from('connections')
      .select('*, profiles!connections_receiver_id_fkey(*), profiles!connections_sender_id_fkey(*)')
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq('status', 'accepted');

    if (accepted) {
      setContacts(accepted.map(c => {
        const other = c.sender_id === userId ? c['profiles!connections_receiver_id_fkey'] : c['profiles!connections_sender_id_fkey'];
        return { ...other, connection_id: c.id };
      }));
    }

    // Get pending message requests
    const { data: pending } = await supabase
      .from('connections')
      .select('*, profiles!connections_sender_id_fkey(*)')
      .eq('receiver_id', userId)
      .eq('status', 'pending');
    
    if (pending) {
      setMessageRequests(pending.map(p => ({ ...p['profiles!connections_sender_id_fkey'], request_id: p.id })));
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

    if (msg.type === 'edit') {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content, edited: true } : m));
    } else if (msg.type === 'delete') {
      setMessages(prev => prev.filter(m => m.id !== msg.id));
    } else {
      // Logic for Message Requests: If we get a message from someone NOT in contacts, reload connections
      const isFromActive = activeContact && (msg.sender_id === activeContact.id || msg.receiver_id === activeContact.id);
      
      if (isFromActive) {
        setMessages((prev) => {
          if (prev.find(m => m.id === msg.id)) return prev.map(m => m.id === msg.id ? { ...m, ...msg, status: 'sent' } : m);
          return [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
        });
      } else if (msg.receiver_id === identity?.id) {
        // New request received, refresh sidebar
        loadConnections(identity.id);
      }
    }
    
    setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 100);
  }, [activeContact, identity]);

  useEffect(() => {
    if (!session || !identity) return;
    clientRef.current = new ChatClient(identity.id, handleNewMessage, setIsOnline);
    
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
    };
  }, [session, identity, activeContact, handleNewMessage]);

  // 4. Actions
  const openChatWithSearch = async (user) => {
    setSearchQuery('');
    setSearchResults([]);
    setActiveContact(user);
    if(window.innerWidth < 640) setShowSidebar(false);
  };

  const acceptRequest = async (request) => {
    await supabase.from('connections').update({ status: 'accepted' }).eq('id', request.request_id);
    loadConnections(identity.id);
    setActiveContact(request);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !activeContact) return;

    // Check if we need to create a connection request first
    const isConnected = contacts.find(c => c.id === activeContact.id);
    const isRequested = messageRequests.find(r => r.id === activeContact.id);

    if (!isConnected && !isRequested) {
      // First message to a stranger creates a 'pending' connection automatically
      await supabase.from('connections').insert([{ sender_id: identity.id, receiver_id: activeContact.id, status: 'pending' }]);
      loadConnections(identity.id);
    }

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

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    setIsSearching(true);
    const { data } = await supabase.from('profiles').select('*').or(`username.ilike.%${query}%,email.ilike.%${query}%`).neq('id', identity.id).limit(5);
    setSearchResults(data || []);
    setIsSearching(false);
  };

  if (authLoading) return <div className="h-screen bg-gray-900 flex items-center justify-center text-gray-400 font-medium">Booting chat...</div>;
  if (!session) return <Auth onAuthComplete={() => window.location.reload()} />;

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans selection:bg-blue-500/30 overflow-hidden">
      
      {/* Sidebar */}
      <aside className={`${showSidebar ? 'w-full sm:w-80' : 'w-0'} bg-gray-800/40 border-r border-gray-700/50 flex flex-col transition-all overflow-hidden z-30`}>
        <div className="p-5 border-b border-gray-700/50 flex items-center justify-between">
           <h2 className="font-bold flex items-center gap-2 text-lg"><Users size={20} className="text-blue-400"/> Contacts</h2>
           <button onClick={() => setShowSidebar(false)} className="sm:hidden text-gray-400 p-1 hover:bg-gray-700 rounded-lg"><X size={20}/></button>
        </div>
        
        <div className="p-4">
          <div className="relative group">
            <Search className="absolute left-3 top-2.5 text-gray-500 group-focus-within:text-blue-400 transition-colors" size={16} />
            <input 
              type="text" 
              placeholder="Search people..." 
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full bg-gray-900/80 border border-gray-700 rounded-xl py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all" 
            />
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden border-t-0">
                {searchResults.map(user => (
                  <button key={user.id} onClick={() => openChatWithSearch(user)} className="w-full p-3 hover:bg-gray-700 flex items-center gap-3 transition-colors border-b border-gray-700 last:border-0">
                    <span className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: user.color }} />
                    <div className="text-left flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{user.username}</p>
                      <p className="text-[10px] text-gray-500 truncate">Click to message</p>
                    </div>
                    <UserPlus size={16} className="text-blue-400" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {messageRequests.length > 0 && (
            <div className="px-2 mb-4">
              <p className="px-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Inbox size={12}/> Message Requests</p>
              {messageRequests.map(r => (
                <button 
                  key={r.id} 
                  onClick={() => { setActiveContact(r); if(window.innerWidth < 640) setShowSidebar(false); }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all mb-1 ${activeContact?.id === r.id ? 'bg-amber-500/20 border border-amber-500/30' : 'bg-amber-500/5 hover:bg-amber-500/10'}`}
                >
                  <span className="w-10 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-sm font-bold truncate text-amber-400">{r.username}</p>
                    <p className="text-[10px] text-amber-500/70 truncate italic font-medium text-xs">New message request</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="px-2">
             <p className="px-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Connected</p>
             {contacts.map(c => (
               <button 
                key={c.id} 
                onClick={() => { setActiveContact(c); if(window.innerWidth < 640) setShowSidebar(false); }}
                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all mb-1 ${activeContact?.id === c.id ? 'bg-blue-600 shadow-lg shadow-blue-600/20' : 'hover:bg-gray-700/40'}`}
               >
                 <span className="w-10 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                 <div className="text-left flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{c.username}</p>
                    <p className="text-xs text-gray-400 truncate opacity-70">Active chat</p>
                 </div>
               </button>
             ))}
          </div>
        </div>

        <div className="p-4 border-t border-gray-700/50 flex items-center justify-between bg-gray-900/20">
           <div className="flex items-center gap-2 truncate">
              <span className="w-8 h-8 rounded-full border border-gray-700" style={{ backgroundColor: identity?.color }} />
              <span className="text-sm font-bold truncate">{identity?.username}</span>
           </div>
           <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-all" title="Sign Out"><LogOut size={18}/></button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-gray-900 shadow-2xl">
        <header className="h-16 flex-shrink-0 border-b border-gray-700/50 bg-gray-800/20 flex items-center justify-between px-4 sm:px-6">
           <div className="flex items-center gap-3">
              <button onClick={() => setShowSidebar(true)} className="sm:hidden text-gray-400 p-2 hover:bg-gray-700 rounded-lg"><MessageSquare size={22}/></button>
              {activeContact ? (
                <>
                  <span className="w-9 h-9 rounded-full border border-gray-700" style={{ backgroundColor: activeContact.color }} />
                  <div>
                    <h3 className="font-bold text-sm sm:text-base leading-tight">{activeContact.username}</h3>
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-medium">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      online
                    </div>
                  </div>
                </>
              ) : (
                <h3 className="font-semibold text-gray-500 italic text-sm">Open a conversation to begin</h3>
              )}
           </div>
           <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              <Wifi size={14} /> <span className="hidden xs:inline">{isOnline ? 'Network Active' : 'Offline'}</span>
           </div>
        </header>

        {activeContact && messageRequests.find(r => r.id === activeContact.id) && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 p-3 flex items-center justify-between">
            <p className="text-xs text-amber-400 font-medium ml-2">Message Request: Do you want to chat with {activeContact.username}?</p>
            <button onClick={() => acceptRequest(messageRequests.find(r => r.id === activeContact.id))} className="bg-amber-500 hover:bg-amber-600 text-gray-900 text-xs font-bold py-1.5 px-4 rounded-lg transition-colors mr-2">Accept</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
          {messages.length === 0 && activeContact && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
               <MessageSquare size={48} className="mb-4" />
               <p className="text-sm font-medium">No messages here yet.<br/>Start the conversation!</p>
            </div>
          )}
          {messages.map((msg, idx) => {
            const isMe = msg.sender_id === identity?.id;
            const showName = !isMe && (idx === 0 || messages[idx - 1].sender_id !== msg.sender_id);
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {showName && <span className="text-[10px] font-bold mb-1 opacity-50 ml-1" style={{ color: msg.color }}>{msg.sender}</span>}
                <div className="relative group max-w-[85%] sm:max-w-[70%]">
                  <div className={`px-4 py-2.5 rounded-2xl ${isMe ? 'bg-blue-600 text-white rounded-br-sm shadow-blue-600/20' : 'bg-gray-800 text-gray-100 rounded-bl-sm border border-gray-700/50 shadow-black/40'} shadow-xl`}>
                    <div className="leading-relaxed whitespace-pre-wrap break-words text-sm sm:text-base">{renderContent(msg.content)}</div>
                    {(msg.edited || msg.status === 'sent') && (
                      <div className="mt-1 flex items-center justify-end gap-1 opacity-40 text-[9px] font-medium uppercase tracking-tighter italic">
                        {msg.edited && <span>edited</span>}
                      </div>
                    )}
                  </div>
                  {isMe && (
                    <div className="absolute top-0 right-full mr-1 opacity-0 group-hover:opacity-100 transition-opacity flex">
                      <button onClick={() => setActiveMenuId(activeMenuId === msg.id ? null : msg.id)} className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-800 transition-colors"><MoreVertical size={16}/></button>
                      {activeMenuId === msg.id && (
                        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-40 py-1.5 overflow-hidden min-w-[120px]">
                          <button onClick={() => { setEditingId(msg.id); setInput(msg.content); setActiveMenuId(null); }} className="w-full px-4 py-2 text-left text-xs hover:bg-gray-700 flex items-center gap-2.5 font-medium"><Edit2 size={14}/> Edit</button>
                          <button onClick={() => { if(confirm('Delete permanently?')) { clientRef.current.deleteMessage(msg.id, activeContact.id); setMessages(prev => prev.filter(m => m.id !== msg.id)); } setActiveMenuId(null); }} className="w-full px-4 py-2 text-left text-xs hover:bg-rose-900/30 text-rose-400 flex items-center gap-2.5 font-medium"><Trash2 size={14}/> Delete</button>
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
        <div className="h-6 px-6 text-[10px] text-gray-500 italic font-medium">
          {Object.keys(typingUsers).filter(u => u !== identity?.username).length > 0 && (
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" />
              {Object.keys(typingUsers).filter(u => u !== identity?.username).join(', ')} typing...
            </span>
          )}
        </div>

        <footer className="p-3 sm:p-5 bg-gray-900/80 backdrop-blur-xl border-t border-gray-800 relative z-20">
          {showEmoji && <div className="absolute bottom-full left-4 z-50 p-2 mb-2 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700"><EmojiPicker theme="dark" onEmojiClick={(e) => setInput(prev => prev + e.emoji)} width={300} height={380}/></div>}
          <form onSubmit={handleSend} className={`max-w-4xl mx-auto flex items-end gap-1 sm:gap-2 bg-gray-800 border border-gray-700/80 rounded-[2rem] p-1.5 transition-all shadow-2xl focus-within:border-blue-500/50 ${!activeContact ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
             <button type="button" onClick={() => setShowEmoji(!showEmoji)} className={`p-2.5 rounded-full transition-all ${showEmoji ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-blue-400 hover:bg-blue-400/5'}`}><Smile size={20}/></button>
             <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
             <button type="button" onClick={() => fileInputRef.current.click()} disabled={uploading} className="p-2.5 text-gray-400 hover:text-blue-400 rounded-full hover:bg-blue-400/5 transition-all">
               {uploading ? <Loader2 className="animate-spin" size={20}/> : <ImageIcon size={20}/>}
             </button>
             <input type="text" value={input} onChange={(e) => { setInput(e.target.value); if(activeContact) clientRef.current.sendTyping(identity.username, activeContact.id); }} placeholder={editingId ? "Correcting message..." : (activeContact ? `Message ${activeContact.username}...` : "Select a contact")} className="flex-1 bg-transparent px-2 py-3 outline-none text-gray-100 text-base placeholder:text-gray-500" />
             <button type="submit" disabled={!input.trim()} className={`p-3 rounded-full transition-all flex-shrink-0 active:scale-90 shadow-xl ${editingId ? 'bg-amber-500 hover:bg-amber-400 shadow-amber-500/30' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/30'}`}>
                {editingId ? <Check size={20} className="text-gray-900"/> : <Send size={20} className="text-white ml-0.5"/>}
             </button>
          </form>
        </footer>
      </main>
    </div>
  );
}
