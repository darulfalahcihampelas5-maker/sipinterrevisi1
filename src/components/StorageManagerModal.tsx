import React, { useState, useEffect } from 'react';
import { Trash2, X, Database, HardDrive, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';
import { motion } from 'motion/react';
import { db, storage } from '../lib/firebase';
import { ref, deleteObject, getMetadata } from 'firebase/storage';
import { deleteDoc, doc } from 'firebase/firestore';

interface StorageManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  submissions: any[];
}

export const StorageManagerModal: React.FC<StorageManagerModalProps> = ({
  isOpen,
  onClose,
  submissions,
}) => {
  const [fileData, setFileData] = useState<any[]>([]);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Filter submissions that have files
      const files = submissions.filter(s => s.fileUrl);
      setFileData(files);
    }
  }, [isOpen, submissions]);

  const handleDelete = async (submission: any) => {
    setIsDeleting(submission.id);
    try {
      // 1. Delete from Storage
      if (submission.fileUrl) {
        const storageRef = ref(storage, submission.fileUrl);
        try {
          await deleteObject(storageRef);
        } catch (e) {
          console.warn("File mungkin sudah dihapus atau tidak ditemukan di Storage:", e);
        }
      }
      
      // 2. Delete from Firestore
      await deleteDoc(doc(db, "submissions", submission.id));
      
      setFileData(prev => prev.filter(f => f.id !== submission.id));
    } catch (error) {
      console.warn("Gagal menghapus file:", error);
    } finally {
      setIsDeleting(null);
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-100 rounded-2xl text-emerald-600">
              <Database className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-black text-slate-900 uppercase tracking-widest">Manajemen Penyimpanan</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-500" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <p className="text-sm text-slate-500 mb-6 font-medium">
            Daftar tugas siswa yang disimpan di Cloud Storage. Hapus file yang tidak diperlukan untuk mengosongkan ruang.
          </p>

          <div className="space-y-3">
            {fileData.length === 0 ? (
              <div className="text-center py-12 text-slate-400 font-medium italic">Tidak ada file tugas siswa di penyimpanan.</div>
            ) : (
              fileData.map((sub, idx) => (
                <div key={`storage-sub-${sub.id || idx}-${idx}`} className="flex items-center gap-4 p-4 border border-slate-100 rounded-2xl hover:border-slate-200 transition-colors">
                  <div className="p-3 bg-slate-100 rounded-xl text-slate-500">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{sub.studentName || 'Siswa'}</p>
                    <p className="text-xs text-slate-500 truncate">{sub.title || 'Tugas Tanpa Judul'}</p>
                  </div>
                  <button 
                    onClick={() => handleDelete(sub)}
                    disabled={isDeleting === sub.id}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isDeleting === sub.id ? '...' : <Trash2 className="w-5 h-5" />}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
