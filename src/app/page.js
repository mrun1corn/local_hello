/* eslint-disable */
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Wifi, WifiOff, LogOut, Search, Image as ImageIcon, Loader2, MoreVertical, Edit2, Trash2, Smile, X, UserPlus, Check, MessageSquare, Users, Inbox, ShieldAlert, CheckCheck, Settings, Bell, BellOff, History } from 'lucide-react';
import Auth from '@/components/Auth';
import CreateGroupModal from '@/components/CreateGroupModal';
import EmojiPicker from 'emoji-picker-react';
import toast, { Toaster } from 'react-hot-toast';
import { auth } from '@/lib/firebase';
import { ChatClient } from '@/lib/chat-client';
import { onAuthStateChanged, signOut } from 'firebase/auth';

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
  const [identity, setIdentity] = useState(null);
  const [session, setSession] = useState(null);
  const [token, setToken] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [contacts, setContacts] = useState([]);
  const [messageRequests, setMessageRequests] = useState([]);
  const [blockedProfiles, setBlockedProfiles] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [groups, setGroups] = useState([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [msgSearch, setMsgSearch] = useState('');
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editInput, setEditInput] = useState('');
  
  const [uploading, setUploading] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [showEmoji, setShowEmoji] = useState(false);
  const [isLocalOnline, setIsLocalOnline] = useState(false);
  
  const activeContactRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatClientRef = useRef(null);

  // Initialize ChatClient for Local WebSocket support
  useEffect(() => {
    if (identity?.id && token) {
      chatClientRef.current = new ChatClient(
        identity.id,
        token,
        (msg) => {
          // Handle incoming message from local websocket
          if (msg.type === 'edit') {
             setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content } : m));
             return;
          }
          if (msg.type === 'delete') {
             setMessages(prev => prev.filter(m => m.id === msg.id));
             return;
          }

          if (msg.sender_id === activeContactRef.current?.id || msg.receiver_id === activeContactRef.current?.id) {
            setMessages(prev => {
              if (prev.find(p => p.id === msg.id)) return prev;
              const newMsgs = [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
              return newMsgs;
            });
          }
          
          // Optionally handle notifications for other contacts
          if (msg.sender_id !== identity.id && msg.sender_id !== activeContactRef.current?.id) {
            toast(`New message from ${msg.sender}`, { icon: '💬' });
          }
        },
        (status) => setIsLocalOnline(status)
      );
    }
    return () => {
      if (chatClientRef.current?.ws) chatClientRef.current.ws.close();
    };
  }, [identity?.id, token]);

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setSession({ user });
        try {
          const t = await user.getIdToken();
          setToken(t);
          const res = await fetch(`/api/profiles?id=${user.uid}`, {
            headers: { 'Authorization': `Bearer ${t}` }
          });
          if (res.ok) {
            const data = await res.json();
            setIdentity(data);
          } else {
            setIdentity(null);
          }
        } catch (e) {
          console.error('Error fetching profile:', e);
          setIdentity(null);
        }
      } else {
        setSession(null);
        setIdentity(null);
        setToken(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Request Notification Permissions
  useEffect(() => {
    if (typeof window !== 'undefined' && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, []);

  // Real-time connections and blocked list via Local API
  useEffect(() => {
    if (!identity || !token) return;

    const fetchData = async () => {
      try {
        // Fetch connections
        const connRes = await fetch(`/api/connections?userId=${identity.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (connRes.ok) {
          const { data } = await connRes.json();
          const accepted = data.filter(c => c.status === 'accepted').map(c => c.sender_id === identity.id ? c.receiverProfile : c.senderProfile).filter(Boolean);
          const pending = data.filter(c => c.status === 'pending' && c.receiver_id === identity.id).map(c => ({ ...c.senderProfile, request_id: c.id })).filter(Boolean);
          setContacts(accepted);
          setMessageRequests(pending);
        }

        // Fetch blocks
        const blocksRes = await fetch(`/api/blocks?userId=${identity.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (blocksRes.ok) {
          const { data } = await blocksRes.json();
          setBlockedProfiles(data.map(b => b.blocked).filter(Boolean));
        }

        // Fetch groups
        const groupsRes = await fetch(`/api/groups?userId=${identity.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (groupsRes.ok) {
          const { data } = await groupsRes.json();
          setGroups(data);
        }
      } catch (e) {
        console.error("Fetch data error:", e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // Poll every 10s for new requests/connections
    return () => clearInterval(interval);
  }, [identity, token]);

  // Real-time messages for active contact
  useEffect(() => {
    activeContactRef.current = activeContact;
    if (!activeContact || !identity || !token) {
      setMessages([]);
      return;
    }

    const fetchMessages = async () => {
      try {
        const res = await fetch(`/api/messages?userId1=${identity.id}&userId2=${activeContact.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const { data } = await res.json();
          setMessages(data.sort((a, b) => a.timestamp - b.timestamp));
          setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 100);
        }
      } catch (e) {
        console.error("Fetch messages error:", e);
      }
    };

    fetchMessages();
    
    // Note: real-time updates are handled by ChatClient WebSocket in the first useEffect
  }, [activeContact, identity, token]);

  const handleDelete = async (msgId) => {
    if (!confirm("Delete this message?")) return;
    try {
        if (chatClientRef.current) chatClientRef.current.deleteMessage(msgId, activeContact.id);
        setMessages(prev => prev.filter(m => m.id !== msgId));
        // Note: in a local-only setup, we might not have a global delete API if it's strictly P2P
        // but since we have /api/messages, we should use it if we want server-side persistence
    } catch (e) { toast.error("Failed to delete message"); }
  };

  const handleEdit = async (msgId, newContent) => {
    if (!newContent.trim()) return;
    try {
        if (chatClientRef.current) chatClientRef.current.editMessage(msgId, activeContact.id, newContent);
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: newContent } : m));
        setEditingMsgId(null);
    } catch (e) { toast.error("Failed to edit message"); }
  };

  const blockUser = async (user) => {
    if (!confirm(`Block ${user.username}?`)) return;
    try {
      await fetch('/api/connections', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sender_id: identity.id, receiver_id: user.id, status: 'blocked' })
      });
      setActiveContact(null);
      toast.error(`Blocked ${user.username}`);
    } catch (e) { toast.error("Failed to block user"); }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !activeContact) return;

    const isFriend = contacts.find(c => c.id === activeContact.id);
    const isReq = messageRequests.find(r => r.id === activeContact.id);
    const isGroup = activeContact.isGroup;
    
    if (!isFriend && !isReq && !isGroup) {
       await fetch('/api/connections', {
         method: 'POST',
         headers: { 
           'Content-Type': 'application/json',
           'Authorization': `Bearer ${token}`
         },
         body: JSON.stringify({
           sender_id: identity.id,
           receiver_id: activeContact.id,
           status: 'pending'
         })
       });
    }

    const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const messageData = {
      id: msgId,
      sender: identity.username,
      sender_id: identity.id,
      receiver_id: activeContact.id,
      color: identity.color,
      content: input.trim(),
      timestamp: Date.now(),
      is_read: false
    };

    if (chatClientRef.current) chatClientRef.current.sendMessage(messageData);
    setInput(''); setShowEmoji(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeContact) return;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { 
        method: 'POST', 
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData 
      });
      const data = await res.json();
      if (data.url) {
        const baseUrl = window.location.origin;
        const msg = {
          id: Date.now().toString(),
          sender: identity.username,
          sender_id: identity.id,
          receiver_id: activeContact.id,
          color: identity.color,
          content: `${baseUrl}${data.url}`,
          timestamp: Date.now(),
          is_read: false
        };
        if (chatClientRef.current) chatClientRef.current.sendMessage(msg);
        setMessages(prev => [...prev, msg]);
      }
    } catch (e) { toast.error("Failed to upload image"); } finally { setUploading(false); }
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/profiles?query=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const { data } = await res.json();
        setSearchResults(data.filter(u => u.id !== identity.id));
      }
    } catch (e) { setSearchResults([]); }
    setIsSearching(false);
  };

  if (authLoading) return <div className="h-screen bg-gray-900 flex items-center justify-center text-gray-400 font-medium">Loading LocalChat...</div>;
  if (!session || !identity) return <Auth onAuthComplete={() => window.location.reload()} />;

  const filteredMessages = msgSearch ? messages.filter(m => m.content.toLowerCase().includes(msgSearch.toLowerCase())) : messages;

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans selection:bg-blue-500/30 overflow-hidden text-left">
      <Toaster />
      <CreateGroupModal isOpen={showCreateGroup} onClose={() => setShowCreateGroup(false)} contacts={contacts} identity={identity} token={token} />
      <aside className={`${showSidebar ? 'w-full sm:w-80' : 'w-0'} bg-gray-800/40 border-r border-gray-700/50 flex flex-col transition-all overflow-hidden z-30`}>
        <div className="p-5 border-b border-gray-700/50 flex items-center justify-between">
           <h2 className="font-bold flex items-center gap-2 text-lg text-blue-400"><MessageSquare size={20}/> Chats</h2>
           <div className="flex gap-1">
             <button onClick={() => setShowCreateGroup(true)} className="p-2 hover:bg-gray-700 rounded-lg text-gray-400" title="Create Group"><Users size={18}/></button>
             <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-gray-700 rounded-lg text-gray-400"><Settings size={18}/></button>
             <button onClick={() => setShowSidebar(false)} className="sm:hidden p-2 text-gray-400"><X size={20}/></button>
           </div>
        </div>
        
        {showSettings ? (
          <div className="flex-1 p-5 space-y-6 overflow-y-auto">
             <div className="flex items-center justify-between"><h3 className="font-bold text-sm uppercase text-gray-500">Settings</h3><button onClick={() => setShowSettings(false)} className="text-xs text-blue-400 font-bold">Done</button></div>
             <div className="space-y-4">
                <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700/50">
                   <p className="text-[10px] font-bold text-gray-500 mb-2 uppercase">Profile</p>
                   <div className="text-sm font-medium">{identity?.username}</div>
                </div>
                <div className="space-y-2">
                   <p className="text-[10px] font-bold text-gray-500 uppercase">Blocked</p>
                   {blockedProfiles.map(p => <div key={p.id} className="text-sm p-2 bg-rose-500/5 border border-rose-500/10 rounded-lg flex justify-between">{p.username}</div>)}
                </div>
                <button onClick={() => signOut(auth)} className="w-full flex items-center justify-center gap-2 p-3 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-xl transition-all font-bold text-sm"><LogOut size={16}/> Sign Out</button>
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
                    {isSearching ? <div className="p-4 text-center text-xs flex gap-2 justify-center items-center"><Loader2 className="animate-spin" size={14}/> Searching...</div> : 
                     searchResults.length > 0 ? searchResults.map(user => (
                      <button key={user.id} onClick={() => { setActiveContact(user); setSearchQuery(''); setSearchResults([]); if(window.innerWidth < 640) setShowSidebar(false); }} className="w-full p-3 hover:bg-gray-700 flex items-center gap-3 border-b border-gray-700 last:border-0 text-left">
                        <span className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: user.color }} /><p className="text-sm font-semibold truncate flex-1">{user.username}</p><UserPlus size={16} className="text-blue-400" />
                      </button>
                    )) : <div className="p-4 text-center text-xs text-gray-500">No users found</div>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
              {messageRequests.length > 0 && (
                <div className="mb-4">
                  <p className="px-3 text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2 flex items-center gap-1.5 relative">
                    <Inbox size={12}/> Requests
                    <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" />
                  </p>
                  {messageRequests.map(r => (
                    <button key={r.id} onClick={() => { setActiveContact(r); if(window.innerWidth < 640) setShowSidebar(false); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all mb-1 ${activeContact?.id === r.id ? 'bg-amber-500/20' : 'bg-amber-500/5'}`}>
                      <span className="w-10 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} /><div className="text-left flex-1 min-w-0 font-bold text-amber-400">{r.username}</div>
                    </button>
                  ))}
                </div>
              )}
              {groups.length > 0 && (
                <div className="mb-4">
                  <p className="px-3 text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Users size={12}/> Groups</p>
                  {groups.map(g => (
                    <button key={g.id} onClick={() => { setActiveContact(g); if(window.innerWidth < 640) setShowSidebar(false); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all mb-1 ${activeContact?.id === g.id ? 'bg-emerald-600 shadow-lg' : 'hover:bg-gray-700/40'}`}>
                       <span className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white text-lg" style={{ backgroundColor: g.color }}>{g.name[0]?.toUpperCase()}</span>
                       <div className="text-left flex-1 min-w-0 font-semibold">{g.name}</div>
                    </button>
                  ))}
                </div>
              )}
              <p className="px-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Connected</p>
              {contacts.map(c => (
                <button key={c.id} onClick={() => { setActiveContact(c); if(window.innerWidth < 640) setShowSidebar(false); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all mb-1 ${activeContact?.id === c.id ? 'bg-blue-600 shadow-lg' : 'hover:bg-gray-700/40'}`}>
                   <span className="w-10 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} /><div className="text-left flex-1 min-w-0 font-semibold">{c.username}</div>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="p-4 border-t border-gray-700/50 flex items-center justify-between">
           <div className="flex items-center gap-2 truncate">
             {identity && (
               <>
                 <span className="w-8 h-8 rounded-full border border-gray-700 flex-shrink-0" style={{ backgroundColor: identity.color }} />
                 <span className="text-sm font-bold truncate">{identity.username}</span>
               </>
             )}
           </div>
           <button onClick={() => signOut(auth)} className="p-2 text-gray-400 hover:text-rose-400 transition-all"><LogOut size={18}/></button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-gray-900 shadow-2xl">
        <header className="h-16 flex-shrink-0 border-b border-gray-700/50 bg-gray-800/20 flex items-center justify-between px-4 sm:px-6">
           <div className="flex items-center gap-3 overflow-hidden text-left">
              <button onClick={() => setShowSidebar(true)} className="sm:hidden text-gray-400 p-2 hover:bg-gray-700 rounded-lg relative">
                <MessageSquare size={22}/>
                {messageRequests.length > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-gray-900" />}
              </button>
              {activeContact && (
                <>
                  <span className="w-9 h-9 rounded-full border border-gray-700 flex-shrink-0 flex items-center justify-center font-bold text-white" style={{ backgroundColor: activeContact.color }}>
                    {activeContact.isGroup ? activeContact.name[0]?.toUpperCase() : ''}
                  </span>
                  <div className="min-w-0 text-left">
                    <h3 className="font-bold text-sm sm:text-base truncate">{activeContact.isGroup ? activeContact.name : activeContact.username}</h3>
                    <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">online</div>
                  </div>
                </>
              )}
           </div>
           <div className="flex items-center gap-2">
              {activeContact && (
                <>
                  {showMsgSearch ? (
                    <div className="flex items-center bg-gray-800 rounded-lg px-2 border border-gray-700">
                       <input autoFocus placeholder="Find..." value={msgSearch} onChange={e => setMsgSearch(e.target.value)} className="bg-transparent border-none outline-none py-1 text-xs w-24 sm:w-40" />
                       <button onClick={() => { setMsgSearch(''); setShowMsgSearch(false); }} className="p-1 text-gray-500"><X size={14}/></button>
                    </div>
                  ) : <button onClick={() => setShowMsgSearch(true)} className="p-2 text-gray-500 hover:text-gray-300"><History size={18}/></button>}
                  <button onClick={() => blockUser(activeContact)} className="p-2 text-gray-500 hover:text-rose-400"><ShieldAlert size={18}/></button>
                </>
              )}
              <div className={`p-2 rounded-full text-emerald-400`}><Wifi size={16} /></div>
           </div>
        </header>

        {activeContact && messageRequests.find(r => r.id === activeContact.id) && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 p-3 flex items-center justify-between px-6">
            <p className="text-xs text-amber-400 font-bold">New Message Request</p>
            <button onClick={async () => {
              const req = messageRequests.find(r => r.id === activeContact.id);
              await fetch('/api/connections', {
                method: 'PUT',
                headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ id: req.request_id, status: 'accepted' })
              });
            }} className="bg-amber-500 text-gray-900 text-[10px] font-bold py-1 px-4 rounded-full uppercase tracking-tighter">Accept</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
          {filteredMessages.map((msg, idx) => {
            const isMe = msg.sender_id === identity?.id;
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className="relative group max-w-[85%] sm:max-w-[70%] text-left">
                  <div className={`px-4 py-2.5 rounded-2xl ${isMe ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-gray-800 text-gray-100 rounded-bl-sm border border-gray-700/50'} shadow-xl`}>
                    {editingMsgId === msg.id ? (
                      <div className="flex flex-col gap-2 min-w-[200px]">
                        <textarea 
                          autoFocus
                          value={editInput} 
                          onChange={e => setEditInput(e.target.value)}
                          className="bg-gray-900/50 border border-white/20 rounded-lg p-2 text-sm outline-none focus:border-white/40"
                        />
                        <div className="flex justify-end gap-2">
                           <button onClick={() => setEditingMsgId(null)} className="text-[10px] uppercase font-bold opacity-60 hover:opacity-100">Cancel</button>
                           <button onClick={() => handleEdit(msg.id, editInput)} className="text-[10px] uppercase font-bold text-emerald-400">Save</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="leading-relaxed whitespace-pre-wrap break-words text-sm sm:text-base">{renderContent(msg.content, msgSearch)}</div>
                        <div className="mt-1 flex items-center justify-end gap-1 opacity-40 text-[9px] font-bold">
                          {isMe && (msg.is_read ? <CheckCheck size={12} className="text-emerald-300"/> : <Check size={12}/>)}
                        </div>
                      </>
                    )}
                  </div>
                  {isMe && !editingMsgId && (
                    <div className="absolute -left-14 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all bg-gray-900/50 rounded-lg p-1">
                      <button onClick={() => { setEditingMsgId(msg.id); setEditInput(msg.content); }} className="p-1 text-gray-500 hover:text-blue-400"><Edit2 size={14}/></button>
                      <button onClick={() => handleDelete(msg.id)} className="p-1 text-gray-600 hover:text-rose-400"><Trash2 size={14}/></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} className="h-4" />
        </div>

        <footer className="p-2 sm:p-5 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:pb-5 bg-gray-900/80 backdrop-blur-xl border-t border-gray-800">
          <form onSubmit={handleSend} className={`max-w-4xl mx-auto flex items-center gap-1 sm:gap-2 bg-gray-800 border border-gray-700/80 rounded-full p-1 sm:p-1.5 transition-all shadow-2xl focus-within:border-blue-500/50 ${!activeContact ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
             <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2.5 text-gray-400 hover:text-blue-400 transition-all rounded-full">{uploading ? <Loader2 className="animate-spin" size={20}/> : <ImageIcon size={20}/>}</button>
             <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
             <button type="button" onClick={() => setShowEmoji(!showEmoji)} className={`p-2.5 rounded-full transition-all ${showEmoji ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-blue-400'}`}><Smile size={20}/></button>
             <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={activeContact ? `Message ${activeContact.username}...` : "Select chat"} className="flex-1 bg-transparent px-2 py-2 sm:py-3 outline-none text-gray-100 text-[16px] placeholder:text-gray-500" />
             <button type="submit" disabled={!input.trim()} className="p-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full transition-all flex-shrink-0 active:scale-90 shadow-lg shadow-blue-600/20"><Send size={18} className="translate-x-0.5"/></button>
          </form>
        </footer>
      </main>
    </div>
  );
}
