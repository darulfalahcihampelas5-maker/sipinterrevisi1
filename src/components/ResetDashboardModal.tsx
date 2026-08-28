import React, { useState } from 'react';
import { AlertTriangle, X, Lock, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

interface ResetDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (resetType: 'semester' | 'tahun' | 'semua', password: string, onProgress: (percent: number) => void) => Promise<void>;
}

export const ResetDashboardModal: React.FC<ResetDashboardModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [resetType, setResetType] = useState<'semester' | 'tahun' | 'semua'>('semester');
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [progress, setProgress] = useState(0);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  if (!isOpen) return null;

  const handleReset = async () => {
    setIsResetting(true);
    setProgress(0);
    try {
      await onConfirm(resetType, password, (p) => setProgress(p));
      setIsSuccess(true);
    } catch (error) {
      console.warn("Reset failed:", error);
    } finally {
      setIsResetting(false);
    }
  };

  const isFormValid = confirmText === 'HAPUS' && password !== '';

  const resetOptions = [
    {
      id: 'semester',
      title: 'Reset Semester Baru',
      desc: 'Menghapus nilai & pengumpulan tugas. Data siswa & kelas tetap aman.',
      color: 'border-blue-200 hover:border-blue-500 bg-blue-50/30'
    },
    {
      id: 'tahun',
      title: 'Reset Tahun Ajaran Baru',
      desc: 'Menghapus siswa, kelas, tugas & nilai. Pengumuman tetap aman.',
      color: 'border-amber-200 hover:border-amber-500 bg-amber-50/30'
    },
    {
      id: 'semua',
      title: 'Reset Semuanya',
      desc: 'Menghapus seluruh data aplikasi tanpa sisa (Factory Reset).',
      color: 'border-rose-200 hover:border-rose-500 bg-rose-50/30'
    }
  ];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl" onClick={onClose}></div>
      <div className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 z-10 animate-in zoom-in-95 duration-200">
        <div className="bg-slate-950 text-white p-6 px-8 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
            <h2 className="text-sm font-black uppercase tracking-widest text-[#85cc00]">Pusat Inisialisasi Ulang</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          {isSuccess ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">Berhasil</h3>
              <p className="text-slate-600 font-bold">Semua Data Sudah Berhasil Dihapus</p>
              <button onClick={onClose} className="mt-6 w-full p-4 bg-slate-900 text-white rounded-2xl font-black">Tutup</button>
            </div>
          ) : (
          <>
          <div className="space-y-3">
            <label className="block text-sm font-black text-slate-900 uppercase tracking-tight">Pilih Tipe Reset</label>
            <div className="grid gap-3">
              {resetOptions.map((opt, idx) => (
                <button
                  key={`reset-opt-${opt.id || idx}-${idx}`}
                  onClick={() => setResetType(opt.id as any)}
                  className={`flex flex-col text-left p-4 rounded-2xl border-2 transition-all ${
                    resetType === opt.id 
                      ? opt.id === 'semua' ? 'border-rose-600 bg-rose-50' : 'border-blue-600 bg-blue-50' 
                      : 'border-slate-100 hover:border-slate-300 bg-white'
                  }`}
                >
                  <span className={`font-black text-sm ${resetType === opt.id ? 'text-slate-900' : 'text-slate-700'}`}>
                    {opt.title}
                  </span>
                  <span className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
                    {opt.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {(isResetting || progress > 0) && (
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <span>Progres Penghapusan Data</span>
                <span className="text-emerald-600 font-black">{progress}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden border border-slate-200 shadow-inner">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-300" 
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Konfirmasi Teks</label>
              <input 
                type="text" 
                value={confirmText} 
                onChange={(e) => setConfirmText(e.target.value)} 
                disabled={isResetting}
                className="w-full p-4 rounded-2xl border-2 border-slate-100 bg-slate-50 font-black text-center placeholder:font-normal text-red-600 disabled:opacity-50" 
                placeholder='Ketik "HAPUS"' 
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Password Admin</label>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">(Hint: admin123)</span>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-4.5 w-4 h-4 text-slate-400" />
                <input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  disabled={isResetting}
                  className="w-full p-4 pl-12 rounded-2xl border-2 border-slate-100 bg-slate-50 font-black text-black disabled:opacity-50" 
                  placeholder="••••••••" 
                />
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button 
              disabled={!isFormValid || isResetting}
              onClick={handleReset}
              className={`w-full p-5 rounded-[1.5rem] font-black text-sm uppercase tracking-widest transition-all shadow-xl ${
                isFormValid && !isResetting
                  ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-200 active:scale-[0.98]' 
                  : 'bg-slate-100 text-slate-400 shadow-none cursor-not-allowed'
              }`}
            >
              {isResetting ? "Sedang Mereset..." : "Eksekusi Reset Sekarang"}
            </button>
            <p className="text-[10px] text-center text-slate-400 mt-4 font-bold uppercase tracking-widest italic">
              Tindakan ini tidak dapat dibatalkan setelah diproses
            </p>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
};
