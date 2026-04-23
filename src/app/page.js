'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Wifi, WifiOff, LogOut, Search, Image as ImageIcon, Loader2, MoreVertical, Edit2, Trash2, Smile, X, UserPlus, Check, MessageSquare, Users, Inbox, ShieldAlert, CheckCheck, Settings, Bell, BellOff, History } from 'lucide-react';
import { ChatClient } from '@/lib/chat-client';
import Auth from '@/components/Auth';
import { supabase } from '@/lib/supabase';
import EmojiPicker from 'emoji-picker-react';
import toast, { Toaster } from 'react-hot-toast';

const renderContent = (content, highlight = '') => {
  if (!content) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = content.split(urlRegex);
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      const isImage = part.match(/\.(jpeg|jpg|gif|png|webp)$/i);
      if (isImage) return <img key={i} src={part} alt="attachment" className="max-w-full rounded-lg mt-2 mb-2 shadow-sm border border-gray-700/50" onLoad={() => window.scrollTo(0, document.body.scrollHeight)} />;
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline break-all hover:text-blue-300">{part}</a>;
    }
    if (highlight && part.toLowerCase().includes(highlight.toLowerCase())) {
      const subParts = part.split(new RegExp(`(${highlight})`, 'gi'));
      return subParts.map((sp, j) => sp.toLowerCase() === highlight.toLowerCase() ? <mark key={`${i}-${j}`} className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{sp}</mark> : sp);
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
  
  const [contacts, setContacts] = useState([]);
  const [messageRequests, setMessageRequests] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [msgSearch, setMsgSearch] = useState('');
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  
  const [blockedProfiles, setBlockedProfiles] = useState([]);
  const [editingProfile, setEditingProfile] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const [showEmoji, setShowEmoji] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState(null);
  
  const clientRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        setIdentity({ id: session.user.id, username: session.user.user_metadata.username, color: session.user.user_metadata.color });
        setNewUsername(session.user.user_metadata.username);
        loadConnections(session.user.id);
        loadBlockedList(session.user.id);
      }
      setAuthLoading(false);
    });
    if ("Notification" in window) setNotificationsEnabled(Notification.permission === "granted");
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        setIdentity({ id: session.user.id, username: session.user.user_metadata.username, color: session.user.user_metadata.color });
        loadConnections(session.user.id);
      } else {
        setIdentity(null); setContacts([]); setMessageRequests([]);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadBlockedList = async (userId) => {
    const { data } = await supabase.from('blocked_users').select('blocked_id, profiles!blocked_users_blocked_id_fkey(*)').eq('blocker_id', userId);
    if (data) setBlockedProfiles(data.map(b => b.profiles));
  };

  const loadConnections = async (userId) => {
    const { data: accepted } = await supabase.from('connections').select('*, profiles!connections_receiver_id_fkey(*), profiles!connections_sender_id_fkey(*)').or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).eq('status', 'accepted');
    if (accepted) setContacts(accepted.map(c => {
      const other = c.sender_id === userId ? c['profiles!connections_receiver_id_fkey'] : c['profiles!connections_sender_id_fkey'];
      return { ...other, connection_id: c.id };
    }));
    const { data: pending } = await supabase.from('connections').select('*, profiles!connections_sender_id_fkey(*)').eq('receiver_id', userId).eq('status', 'pending');
    if (pending) setMessageRequests(pending.map(p => ({ ...p['profiles!connections_sender_id_fkey'], request_id: p.id })));
  };

  const requestNotificationPermission = () => {
    Notification.requestPermission().then(permission => {
      setNotificationsEnabled(permission === "granted");
      if(permission === "granted") toast.success("Notifications enabled!");
    });
  };

  const handleNewMessage = useCallback((msg) => {
    if (blockedProfiles.some(b => b.id === msg.sender_id)) return;
    if (msg.type === 'typing') {
      if (msg.receiver_id === identity?.id) setTypingUsers(prev => ({ ...prev, [msg.sender]: Date.now() }));
      return;
    }
    if (msg.type === 'read') {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_read: true } : m));
      return;
    }
    if (msg.type === 'edit') setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content, edited: true } : m));
    else if (msg.type === 'delete') setMessages(prev => prev.filter(m => m.id !== msg.id));
    else {
      const isFromActive = activeContact && (msg.sender_id === activeContact.id || msg.receiver_id === activeContact.id);
      if (isFromActive) {
        setMessages((prev) => {
          if (prev.find(m => m.id === msg.id)) return prev.map(m => m.id === msg.id ? { ...m, ...msg, status: 'sent' } : m);
          return [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
        });
        if (msg.sender_id !== identity?.id) {
          clientRef.current.markRead(msg.id, msg.sender_id);
          if (notificationsEnabled && document.hidden) new Notification(`New message from ${msg.sender}`, { body: msg.content.substring(0, 50) });
        }
      } else if (msg.receiver_id === identity?.id) {
        loadConnections(identity.id);
        toast(`New message from ${msg.sender}`, { icon: '💬', position: 'top-right' });
      }
    }
    setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 100);
  }, [activeContact, identity, blockedProfiles, notificationsEnabled]);

  useEffect(() => {
    if (!session || !identity) return;
    clientRef.current = new ChatClient(identity.id, handleNewMessage, setIsOnline);
    if (activeContact) {
      supabase.from('messages').select('*').or(`and(sender_id.eq.${identity.id},receiver_id.eq.${activeContact.id}),and(sender_id.eq.${activeContact.id},receiver_id.eq.${identity.id})`).order('timestamp', { ascending: true })
        .then(({ data }) => { 
          if (data) {
            setMessages(data);
            data.filter(m => m.sender_id !== identity.id && !m.is_read).forEach(m => clientRef.current.markRead(m.id, m.sender_id));
          }
        });
    }
    return () => { if (clientRef.current?.ws) clientRef.current.ws.close(); };
  }, [session, identity, activeContact, handleNewMessage]);

  const updateProfile = async () => {
    if (!newUsername.trim()) return;
    if (newUsername === identity.username) { setEditingProfile(false); return; }

    // Check if new username is taken
    const { data: existing } = await supabase
      .from('profiles')
      .select('username')
      .ilike('username', newUsername)
      .single();

    if (existing) {
      toast.error("This username is already taken");
      return;
    }

    const { error } = await supabase.auth.updateUser({ data: { username: newUsername } });
    if (!error) {
      await supabase.from('profiles').update({ username: newUsername }).eq('id', identity.id);
      setIdentity({ ...identity, username: newUsername });
      setEditingProfile(false);
      toast.success("Profile updated!");
    }
  };

  const blockUser = async (user) => {
    if (!confirm(`Block ${user.username}?`)) return;
    clientRef.current.blockUser(user.id);
    setBlockedProfiles(prev => [...prev, user]);
    setActiveContact(null); setActiveMenuId(null);
    toast.error(`Blocked ${user.username}`);
  };

  const unblockUser = async (userId) => {
    await supabase.from('blocked_users').delete().eq('blocker_id', identity.id).eq('blocked_id', userId);
    setBlockedProfiles(prev => prev.filter(p => p.id !== userId));
    toast.success("User unblocked");
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) { alert('File is too large! Please choose an image under 5MB.'); return; }
    setUploading(true);
    const fileName = `${Math.random()}.${file.name.split('.').pop()}`;
    const filePath = `chat/${fileName}`;
    try {
      const { error } = await supabase.storage.from('chat-attachments').upload(filePath, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('chat-attachments').getPublicUrl(filePath);
      clientRef.current.sendMessage({ id: crypto.randomUUID(), sender: identity.username, sender_id: identity.id, receiver_id: activeContact.id, color: identity.color, content: publicUrl, timestamp: Date.now() });
    } catch (error) { toast.error('Failed to upload image.'); } finally { setUploading(false); }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !activeContact) return;
    const isConnected = contacts.find(c => c.id === activeContact.id);
    if (!isConnected) { await supabase.from('connections').insert([{ sender_id: identity.id, receiver_id: activeContact.id, status: 'pending' }]); loadConnections(identity.id); }
    if (editingId) {
      clientRef.current.editMessage(editingId, activeContact.id, input.trim());
      setMessages(prev => prev.map(m => m.id === editingId ? { ...m, content: input.trim(), edited: true } : m));
      setEditingId(null);
    } else clientRef.current.sendMessage({ id: crypto.randomUUID(), sender: identity.username, sender_id: identity.id, receiver_id: activeContact.id, color: identity.color, content: input.trim(), timestamp: Date.now() });
    setInput(''); setShowEmoji(false);
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    setIsSearching(true);
    const { data } = await supabase.from('profiles').select('*').or(`username.ilike.%${query}%,email.ilike.%${query}%`).neq('id', identity.id).limit(5);
    setSearchResults(data || []);
    setIsSearching(false);
  };

  const filteredMessages = msgSearch ? messages.filter(m => m.content.toLowerCase().includes(msgSearch.toLowerCase())) : messages;

  if (authLoading) return <div className="h-screen bg-gray-900 flex items-center justify-center text-gray-400 font-medium">Loading LocalChat...</div>;
  if (!session) return <Auth onAuthComplete={() => window.location.reload()} />;

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans selection:bg-blue-500/30 overflow-hidden text-left">
      <Toaster />
      <aside className={`${showSidebar ? 'w-full sm:w-80' : 'w-0'} bg-gray-800/40 border-r border-gray-700/50 flex flex-col transition-all overflow-hidden z-30`}>
        <div className="p-5 border-b border-gray-700/50 flex items-center justify-between">
           <h2 className="font-bold flex items-center gap-2 text-lg text-blue-400"><MessageSquare size={20}/> Chats</h2>
           <div className="flex gap-1">
             <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-gray-700 rounded-lg text-gray-400 transition-colors"><Settings size={18}/></button>
             <button onClick={() => setShowSidebar(false)} className="sm:hidden p-2 text-gray-400"><X size={20}/></button>
           </div>
        </div>
        {showSettings ? (
          <div className="flex-1 p-5 space-y-6 overflow-y-auto">
             <div className="flex items-center justify-between"><h3 className="font-bold text-sm uppercase text-gray-500 tracking-wider">Settings</h3><button onClick={() => setShowSettings(false)} className="text-xs text-blue-400 font-bold">Done</button></div>
             <div className="space-y-4">
                <div className="bg-gray-900/50 p-4 rounded-2xl border border-gray-700/50">
                   <p className="text-xs font-bold text-gray-500 mb-3 uppercase">Profile</p>
                   {editingProfile ? (
                     <div className="flex gap-2"><input value={newUsername} onChange={e => setNewUsername(e.target.value)} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500 flex-1" /><button onClick={updateProfile} className="p-2 bg-blue-600 rounded-lg"><Check size={16}/></button></div>
                   ) : (
                     <div className="flex items-center justify-between"><span className="text-sm font-medium">{identity.username}</span><button onClick={() => setEditingProfile(true)} className="text-xs text-blue-400">Edit</button></div>
                   )}
                </div>
                <div className="bg-gray-900/50 p-4 rounded-2xl border border-gray-700/50">
                   <div className="flex items-center justify-between"><p className="text-xs font-bold text-gray-500 uppercase">Notifications</p><button onClick={requestNotificationPermission}>{notificationsEnabled ? <Bell className="text-emerald-400" size={18}/> : <BellOff className="text-gray-600" size={18}/>}</button></div>
                </div>
                <div className="space-y-2">
                   <p className="text-xs font-bold text-gray-500 uppercase px-1">Blocked Users</p>
                   {blockedProfiles.map(p => (
                     <div key={p.id} className="flex items-center justify-between bg-rose-500/5 p-3 rounded-xl border border-rose-500/10"><span className="text-sm font-medium">{p.username}</span><button onClick={() => unblockUser(p.id)} className="text-[10px] font-bold text-rose-400 hover:underline">Unblock</button></div>
                   ))}
                   {blockedProfiles.length === 0 && <p className="text-xs text-gray-600 italic px-1">No blocked users</p>}
                </div>
             </div>
          </div>
        ) : (
          <>
            <div className="p-4">
              <div className="relative group">
                <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
                <input type="text" placeholder="Search people..." value={searchQuery} onChange={(e) => handleSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl py-2.5 pl-9 pr-4 text-sm outline-none focus:border-blue-500" />
                {searchQuery.length >= 2 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-[100] overflow-hidden">
                    {isSearching ? (
                      <div className="p-4 text-center text-xs text-gray-500 flex items-center justify-center gap-2"><Loader2 className="animate-spin" size={14}/> Searching...</div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map(user => (
                        <button key={user.id} onClick={() => { setActiveContact(user); setSearchQuery(''); setSearchResults([]); if(window.innerWidth < 640) setShowSidebar(false); }} className="w-full p-3 hover:bg-gray-700 flex items-center gap-3 border-b border-gray-700 last:border-0 text-left">
                          <span className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: user.color }} /><p className="text-sm font-semibold truncate flex-1">{user.username}</p><UserPlus size={16} className="text-blue-400" />
                        </button>
                      ))
                    ) : (
                      <div className="p-4 text-center text-xs text-gray-500 italic">No users found</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
              {messageRequests.length > 0 && (
                <div className="mb-4">
                  <p className="px-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5 relative">
                <Inbox size={12}/> 
                Requests
                <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" />
              </p>
                  {messageRequests.map(r => (
                    <button key={r.id} onClick={() => { setActiveContact(r); if(window.innerWidth < 640) setShowSidebar(false); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all mb-1 ${activeContact?.id === r.id ? 'bg-amber-500/20' : 'bg-amber-500/5 hover:bg-amber-500/10'}`}>
                      <span className="w-10 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} /><div className="text-left flex-1 min-w-0"><p className="text-sm font-bold truncate text-amber-400">{r.username}</p></div>
                    </button>
                  ))}
                </div>
              )}
              <p className="px-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Recent</p>
              {contacts.map(c => (
                <button key={c.id} onClick={() => { setActiveContact(c); if(window.innerWidth < 640) setShowSidebar(false); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all mb-1 ${activeContact?.id === c.id ? 'bg-blue-600 shadow-lg shadow-blue-600/20' : 'hover:bg-gray-700/40'}`}>
                   <span className="w-10 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} /><div className="text-left flex-1 min-w-0"><p className="text-sm font-semibold truncate">{c.username}</p></div>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="p-4 border-t border-gray-700/50 flex items-center justify-between bg-gray-900/20">
           <div className="flex items-center gap-2 truncate"><span className="w-8 h-8 rounded-full border border-gray-700" style={{ backgroundColor: identity?.color }} /><span className="text-sm font-bold truncate">{identity?.username}</span></div>
           <button onClick={() => supabase.auth.signOut()} className="p-2 text-gray-400 hover:text-rose-400 transition-all"><LogOut size={18}/></button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-gray-900">
        <header className="h-16 flex-shrink-0 border-b border-gray-700/50 bg-gray-800/20 flex items-center justify-between px-4 sm:px-6">
           <div className="flex items-center gap-3 overflow-hidden text-left">
              <button onClick={() => setShowSidebar(true)} className="sm:hidden text-gray-400 p-2 hover:bg-gray-700 rounded-lg relative">
                <MessageSquare size={22}/>
                {messageRequests.length > 0 && (
                  <span className="absolute top-1 right-1 w-3 h-3 bg-rose-500 rounded-full border-2 border-gray-900" />
                )}
              </button>
              {activeContact && (
                <>
                  <span className="w-9 h-9 rounded-full border border-gray-700 flex-shrink-0" style={{ backgroundColor: activeContact.color }} />
                  <div className="min-w-0 text-left"><h3 className="font-bold text-sm sm:text-base leading-tight truncate">{activeContact.username}</h3><div className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">online</div></div>
                </>
              )}
           </div>
           <div className="flex items-center gap-2">
              {activeContact && (
                <>
                  {showMsgSearch ? (
                    <div className="flex items-center bg-gray-800 rounded-lg px-2 border border-gray-700">
                       <input autoFocus placeholder="Search..." value={msgSearch} onChange={e => setMsgSearch(e.target.value)} className="bg-transparent border-none outline-none py-1.5 text-xs w-24 sm:w-40" />
                       <button onClick={() => { setMsgSearch(''); setShowMsgSearch(false); }} className="p-1 text-gray-500"><X size={14}/></button>
                    </div>
                  ) : <button onClick={() => setShowMsgSearch(true)} className="p-2 text-gray-500 hover:text-gray-300"><History size={18}/></button>}
                  <div className="relative">
                    <button onClick={() => setActiveMenuId(activeMenuId === 'header' ? null : 'header')} className="p-2 text-gray-500 hover:text-gray-300"><MoreVertical size={20}/></button>
                    {activeMenuId === 'header' && (
                      <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-40 overflow-hidden min-w-[140px]">
                         <button onClick={() => blockUser(activeContact)} className="w-full px-4 py-2.5 text-left text-xs hover:bg-rose-900/30 text-rose-400 flex items-center gap-2.5 font-bold"><ShieldAlert size={14}/> Block</button>
                      </div>
                    )}
                  </div>
                </>
              )}
           </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar" onClick={() => setActiveMenuId(null)}>
          {filteredMessages.map((msg, idx) => {
            const isMe = msg.sender_id === identity?.id;
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className="relative group max-w-[85%] sm:max-w-[70%] text-left">
                  <div className={`px-4 py-2.5 rounded-2xl ${isMe ? 'bg-blue-600 text-white rounded-br-sm shadow-blue-600/20' : 'bg-gray-800 text-gray-100 rounded-bl-sm border border-gray-700/50 shadow-black/40'} shadow-xl`}>
                    <div className="leading-relaxed whitespace-pre-wrap break-words text-sm sm:text-base">{renderContent(msg.content, msgSearch)}</div>
                    <div className="mt-1 flex items-center justify-end gap-1 opacity-40 text-[9px] font-bold uppercase italic">
                      {msg.edited && <span className="mr-1 text-[8px]">edited</span>}
                      {isMe && (msg.is_read ? <CheckCheck size={12} className="text-emerald-300"/> : <Check size={12}/>)}
                    </div>
                  </div>
                  {isMe && (
                    <div className="absolute top-0 right-full mr-1 opacity-0 group-hover:opacity-100 transition-opacity flex">
                      <button onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === msg.id ? null : msg.id); }} className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-800 transition-colors"><MoreVertical size={16}/></button>
                      {activeMenuId === msg.id && (
                        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-40 py-1.5 overflow-hidden min-w-[120px]">
                          <button onClick={() => { setEditingId(msg.id); setInput(msg.content); setActiveMenuId(null); }} className="w-full px-4 py-2 text-left text-xs hover:bg-gray-700 flex items-center gap-2.5 font-medium"><Edit2 size={14}/> Edit</button>
                          <button onClick={() => { if(confirm('Delete?')) { clientRef.current.deleteMessage(msg.id, activeContact.id); setMessages(prev => prev.filter(m => m.id !== msg.id)); } setActiveMenuId(null); }} className="w-full px-4 py-2 text-left text-xs hover:bg-rose-900/30 text-rose-400 flex items-center gap-2.5 font-medium"><Trash2 size={14}/> Delete</button>
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
        <div className="h-6 px-6 text-[10px] text-gray-500 italic font-medium text-left">
          {Object.keys(typingUsers).filter(u => u !== identity?.username).length > 0 && <span className="flex items-center gap-2"><span className="w-1 h-1 bg-blue-500 rounded-full animate-ping" /> Someone is typing...</span>}
        </div>
        <footer className="p-2 sm:p-5 bg-gray-900/80 backdrop-blur-xl border-t border-gray-800 relative z-20">
          {showEmoji && <div className="absolute bottom-full left-2 sm:left-4 z-50 p-2 mb-2 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700"><EmojiPicker theme="dark" onEmojiClick={(e) => setInput(prev => prev + e.emoji)} width={280} height={350}/></div>}
          <form onSubmit={handleSend} className={`max-w-4xl mx-auto flex items-center gap-1 sm:gap-2 bg-gray-800 border border-gray-700/80 rounded-full p-1 sm:p-1.5 transition-all shadow-2xl focus-within:border-blue-500/50 ${!activeContact ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
             <button type="button" onClick={() => setShowEmoji(!showEmoji)} className={`p-2 sm:p-2.5 rounded-full transition-all ${showEmoji ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-blue-400 hover:bg-blue-400/5'}`}><Smile size={20}/></button>
             <button type="button" onClick={() => fileInputRef.current.click()} disabled={uploading} className="p-2 sm:p-2.5 text-gray-400 hover:text-blue-400 rounded-full transition-all"><ImageIcon size={20}/></button>
             <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
             <input type="text" value={input} onChange={(e) => { setInput(e.target.value); if(activeContact) clientRef.current.sendTyping(identity.username, activeContact.id); }} placeholder={activeContact ? "Message..." : "Select chat"} className="flex-1 bg-transparent px-2 py-2 sm:py-3 outline-none text-gray-100 text-[16px] placeholder:text-gray-500" />
             <button type="submit" disabled={!input.trim()} className={`p-3 rounded-full transition-all flex-shrink-0 active:scale-90 shadow-lg ${editingId ? 'bg-amber-500 hover:bg-amber-400' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20'}`}>
                {editingId ? <Check size={18} className="text-gray-900"/> : <Send size={18} className="text-white translate-x-0.5"/>}
             </button>
          </form>
        </footer>
      </main>
    </div>
  );
}
