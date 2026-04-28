import { useState } from 'react';
import { X, Users, Check } from 'lucide-react';
import { addDoc, collection } from 'firebase/firestore';
import { db_fs } from '@/lib/firebase';
import toast from 'react-hot-toast';

export default function CreateGroupModal({ isOpen, onClose, contacts, identity }) {
  const [groupName, setGroupName] = useState('');
  const [selectedContacts, setSelectedContacts] = useState([]);

  if (!isOpen) return null;

  const toggleContact = (id) => {
    setSelectedContacts(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    if (!groupName.trim() || selectedContacts.length === 0) {
      toast.error('Please enter a group name and select at least one contact.');
      return;
    }

    try {
      const color = '#' + Math.floor(Math.random() * 16777215).toString(16);
      await addDoc(collection(db_fs, 'groups'), {
        name: groupName.trim(),
        username: groupName.trim(), // To be compatible with UI rendering
        members: [identity.id, ...selectedContacts],
        created_at: Date.now(),
        color,
        isGroup: true
      });
      toast.success('Group created!');
      setGroupName('');
      setSelectedContacts([]);
      onClose();
    } catch (e) {
      console.error(e);
      toast.error('Failed to create group');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-800 border border-gray-700/50 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-gray-700/50 flex justify-between items-center bg-gray-900/50">
          <h2 className="font-bold flex items-center gap-2"><Users size={18} className="text-blue-400"/> Create Group</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1"><X size={20}/></button>
        </div>
        
        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Group Name</label>
            <input 
              type="text" 
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="E.g. Squad"
              className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 px-4 outline-none focus:border-blue-500 transition-all text-sm"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Select Members ({selectedContacts.length})</label>
            <div className="space-y-2">
              {contacts.length === 0 ? (
                <p className="text-sm text-gray-500 italic">You need connected friends to form a group.</p>
              ) : contacts.map(c => (
                <button 
                  key={c.id} 
                  onClick={() => toggleContact(c.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${selectedContacts.includes(c.id) ? 'bg-blue-600/20 border-blue-500/50 text-white' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-700/50'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                    <span className="font-semibold">{c.username}</span>
                  </div>
                  <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${selectedContacts.includes(c.id) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-600 text-transparent'}`}>
                    <Check size={14} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-700/50 bg-gray-900/50">
          <button 
            onClick={handleCreate}
            disabled={!groupName.trim() || selectedContacts.length === 0}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-all shadow-lg shadow-blue-600/20"
          >
            Create Group
          </button>
        </div>
      </div>
    </div>
  );
}
