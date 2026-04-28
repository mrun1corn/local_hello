/* eslint-disable */
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Wifi, WifiOff, LogOut, Search, Image as ImageIcon, Loader2, MoreVertical, Edit2, Trash2, Smile, X, UserPlus, Check, MessageSquare, Users, Inbox, ShieldAlert, CheckCheck, Settings, Bell, BellOff, History } from 'lucide-react';
import Auth from '@/components/Auth';
import CreateGroupModal from '@/components/CreateGroupModal';
import EmojiPicker from 'emoji-picker-react';
import toast, { Toaster } from 'react-hot-toast';
import { auth, db_fs } from '@/lib/firebase';
import { ChatClient } from '@/lib/chat-client';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  doc, 
  getDoc,
  limit, 
  setDoc,
  getDocs,
  or,
  and
} from 'firebase/firestore';

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
    if (identity?.id) {
      chatClientRef.current = new ChatClient(
        identity.id,
        (msg) => {
          // Handle incoming message from local websocket
          setMessages(prev => {
            // Deduplicate: check if message ID already exists (from firestore or previous local)
            if (prev.find(p => p.id === msg.id)) return prev;
            const newMsgs = [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
            return newMsgs;
          });
        },
        (status) => setIsLocalOnline(status)
      );
    }
    return () => {
      if (chatClientRef.current?.ws) chatClientRef.current.ws.close();
    };
  }, [identity?.id]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          // Check if they have a Firestore profile (username setup)
          const docSnap = await getDoc(doc(db_fs, "users", user.uid));
          
          if (docSnap.exists()) {
            setSession({ user });
            setIdentity(docSnap.data());
          } else {
            // Profile doesn't exist, they need to set up a username in <Auth>
            setSession(null);
            setIdentity(null);
          }
        } catch (e) {
          console.error('Error fetching profile:', e);
          setSession(null);
          setIdentity(null);
        }
      } else {
        setSession(null);
        setIdentity(null);
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

  // Real-time connections and blocked list via Firestore (using local sync for basic info)
  useEffect(() => {
    if (!identity) return;

    // Listen to connections
    const q = query(
      collection(db_fs, "connections"),
      or(where("sender_id", "==", identity.id), where("receiver_id", "==", identity.id))
    );

    const unsub = onSnapshot(q, async (snapshot) => {
      const conn = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const enriched = await Promise.all(conn.map(async c => {
        const otherId = c.sender_id === identity.id ? c.receiver_id : c.sender_id;
        try {
          const docSnap = await getDoc(doc(db_fs, "users", otherId));
          if (!docSnap.exists()) return null;
          const data = docSnap.data();
          return {
            ...c,
            senderProfile: c.sender_id === identity.id ? identity : data,
            receiverProfile: c.receiver_id === identity.id ? identity : data
          };
        } catch(e) { return null; }
      }));

      const valid = enriched.filter(Boolean);
      const accepted = valid.filter(c => c.status === 'accepted').map(c => c.sender_id === identity.id ? c.receiverProfile : c.senderProfile).filter(Boolean);
      const pending = valid.filter(c => c.status === 'pending' && c.receiver_id === identity.id).map(c => ({ ...c.senderProfile, request_id: c.id })).filter(Boolean);
      
      setContacts(accepted);
      setMessageRequests(pending);
    }, (error) => {
      console.error("Connections listener error:", error);
      toast.error(`Connections Error: ${error.message}`);
    });

    // Listen to blocks
    const bq = query(collection(db_fs, "blocks"), where("blocker_id", "==", identity.id));
    const unsubBlocks = onSnapshot(bq, async (snapshot) => {
       const blocks = snapshot.docs.map(doc => doc.data());
       const enriched = await Promise.all(blocks.map(async b => {
         try {
           const docSnap = await getDoc(doc(db_fs, "users", b.blocked_id));
           return docSnap.exists() ? docSnap.data() : null;
         } catch(e) { return null; }
       }));
       setBlockedProfiles(enriched.filter(Boolean));
    }, (error) => {
      console.error("Blocks listener error:", error);
    });

    // Listen to groups
    const gq = query(collection(db_fs, "groups"), where("members", "array-contains", identity.id));
    const unsubGroups = onSnapshot(gq, (snapshot) => {
       const grps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
       setGroups(grps);
    });

    return () => { unsub(); unsubBlocks(); unsubGroups(); };
  }, [identity]);

  // Real-time messages for active contact
  useEffect(() => {
    activeContactRef.current = activeContact;
    if (!activeContact || !identity) {
      setMessages([]);
      return;
    }

    let q;
    if (activeContact.isGroup) {
      q = query(
        collection(db_fs, "messages"),
        where("receiver_id", "==", activeContact.id),
        orderBy("timestamp", "asc")
      );
    } else {
      q = query(
        collection(db_fs, "messages"),
        or(
          and(where("sender_id", "==", identity.id), where("receiver_id", "==", activeContact.id)),
          and(where("sender_id", "==", activeContact.id), where("receiver_id", "==", identity.id))
        ),
        orderBy("timestamp", "asc")
      );
    }

    const unsub = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMessages(msgs);
      
      // Handle notifications
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const m = change.doc.data();
          if (m.sender_id !== identity.id && m.timestamp > Date.now() - 5000) {
            // Beep sound
            try {
               const audio = new Audio("data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq");
               audio.play().catch(()=>{});
            } catch(e){}
            
            if (document.hidden && "Notification" in window && Notification.permission === "granted") {
              new Notification(`New message from ${m.sender}`, { body: m.content });
            }
          }
        }
      });
      
      // Mark as read
      msgs.filter(m => m.sender_id !== identity.id && !m.is_read).forEach(m => {
        updateDoc(doc(db_fs, "messages", m.id), { is_read: true });
      });
      
      setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 100);
    }, (error) => {
      console.error("Messages listener error:", error);
      toast.error(`Messages Error: ${error.message}`);
    });

    return () => unsub();
  }, [activeContact, identity]);

  const blockUser = async (user) => {
    if (!confirm(`Block ${user.username}?`)) return;
    await addDoc(collection(db_fs, "blocks"), { blocker_id: identity.id, blocked_id: user.id });
    setActiveContact(null);
    toast.error(`Blocked ${user.username}`);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !activeContact) return;

    const isFriend = contacts.find(c => c.id === activeContact.id);
    const isReq = messageRequests.find(r => r.id === activeContact.id);
    const isGroup = activeContact.isGroup;
    
    if (!isFriend && !isReq && !isGroup) {
       await addDoc(collection(db_fs, "connections"), {
         sender_id: identity.id,
         receiver_id: activeContact.id,
         status: 'pending',
         created_at: Date.now()
       });
    }

    const msgId = Date.now().toString();
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

    // Send via Local WebSocket
    if (chatClientRef.current) {
      chatClientRef.current.sendMessage(messageData);
    }

    // Send via Cloud Firestore
    await addDoc(collection(db_fs, "messages"), messageData);

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
        body: formData,
      });

      const data = await res.json();
      if (data.url) {
        // Use the same origin for the upload URL to ensure it points to the correct server
        const baseUrl = window.location.origin;
        await addDoc(collection(db_fs, "messages"), {
          sender: identity.username,
          sender_id: identity.id,
          receiver_id: activeContact.id,
          color: identity.color,
          content: `${baseUrl}${data.url}`,
          timestamp: Date.now(),
          is_read: false
        });
      }
    } catch (e) {
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      // Native Firestore prefix search
      const sq = query(
        collection(db_fs, "users"),
        where("username", ">=", query),
        where("username", "<=", query + '\uf8ff')
      );
      const snapshot = await getDocs(sq);
      const data = snapshot.docs.map(doc => doc.data()).filter(u => u.id !== identity.id);
      setSearchResults(data);
    } catch (e) {
      setSearchResults([]);
    }
    setIsSearching(false);
  };

  if (authLoading) return <div className="h-screen bg-gray-900 flex items-center justify-center text-gray-400 font-medium">Loading LocalChat...</div>;
  if (!session) return <Auth onAuthComplete={() => window.location.reload()} />;

  const filteredMessages = msgSearch ? messages.filter(m => m.content.toLowerCase().includes(msgSearch.toLowerCase())) : messages;

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans selection:bg-blue-500/30 overflow-hidden text-left">
      <Toaster />
      <CreateGroupModal isOpen={showCreateGroup} onClose={() => setShowCreateGroup(false)} contacts={contacts} identity={identity} />
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
            <button onClick={() => {
              const req = messageRequests.find(r => r.id === activeContact.id);
              updateDoc(doc(db_fs, "connections", req.request_id), { status: 'accepted' });
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
                    <div className="leading-relaxed whitespace-pre-wrap break-words text-sm sm:text-base">{renderContent(msg.content, msgSearch)}</div>
                    <div className="mt-1 flex items-center justify-end gap-1 opacity-40 text-[9px] font-bold">
                      {isMe && (msg.is_read ? <CheckCheck size={12} className="text-emerald-300"/> : <Check size={12}/>)}
                    </div>
                  </div>
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