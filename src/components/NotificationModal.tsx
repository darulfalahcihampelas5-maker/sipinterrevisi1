import React from 'react';
import { AlertCircle, CheckCircle, X, AlertTriangle, HelpCircle } from 'lucide-react';
import { motion } from 'motion/react';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  title: string;
  message: string;
  type: 'confirm' | 'alert' | 'danger';
  confirmText?: string;
  cancelText?: string;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  type,
  confirmText = 'Proses',
  cancelText = 'Batal'
}) => {
  if (!isOpen) return null;

  const getThemeDetails = () => {
    switch (type) {
      case 'danger':
        return {
          icon: <AlertTriangle className="w-8 h-8 text-rose-600 animate-pulse" />,
          bgColor: 'bg-rose-50',
          borderColor: 'border-rose-100',
          accentColor: 'text-rose-600',
          gradient: 'from-rose-500 to-rose-700',
          buttonStyles: 'bg-[#85cc00] text-slate-950 hover:brightness-110 shadow-[#85cc00]/20 shadow-lg border border-slate-900/10',
          badgeText: 'SISTEM DETEKSI BAHAYA',
        };
      case 'confirm':
        return {
          icon: <HelpCircle className="w-8 h-8 text-amber-600" />,
          bgColor: 'bg-amber-50',
          borderColor: 'border-amber-100',
          accentColor: 'text-amber-800',
          gradient: 'from-[#85cc00] to-[#72b000]',
          buttonStyles: 'bg-[#85cc00] text-[#1c1d1a] hover:bg-[#72b000] shadow-[#85cc00]/20 shadow-lg border border-slate-900/10',
          badgeText: 'REKUES KONFIRMASI',
        };
      case 'alert':
      default:
        return {
          icon: <CheckCircle className="w-8 h-8 text-emerald-600" />,
          bgColor: 'bg-emerald-50',
          borderColor: 'border-emerald-100',
          accentColor: 'text-emerald-700',
          gradient: 'from-[#85cc00] to-[#72b000]',
          buttonStyles: 'bg-[#85cc00] text-slate-950 hover:bg-[#72b000] shadow-[#85cc00]/20 shadow-lg border border-slate-900/10',
          badgeText: 'PEMBERITAHUAN UTAMA',
        };
    }
  };

  const theme = getThemeDetails();

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      {/* Premium backdrop blur overlay */}
      <div 
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl transition-all duration-300" 
        onClick={onClose}
      ></div>

      {/* Luxury container card */}
      <div className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 z-10 animate-in zoom-in-95 duration-200">
        
        {/* Subtle decorative mesh back */}
        <div className="absolute top-0 right-0 p-8 opacity-[0.02] pointer-events-none">
          <AlertCircle className="w-48 h-48 text-slate-900" />
        </div>

        {/* Minimal header strip */}
        <div className="bg-slate-950 text-white p-5 px-8 flex justify-between items-center shrink-0 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#85cc00] animate-ping"></span>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#85cc00]">
              {theme.badgeText}
            </span>
          </div>
          <button 
            onClick={onClose} 
            className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Card Contents */}
        <div className="p-8 sm:p-10 flex flex-col items-center text-center">
          
          {/* Animated dynamic icon ring */}
          <div className={`mb-6 p-5 rounded-[2rem] border-2 shadow-inner ${theme.bgColor} ${theme.borderColor}`}>
            {theme.icon}
          </div>
          
          <h3 className="text-2xl font-display font-black text-slate-950 mb-3 tracking-tight leading-snug">
            {title}
          </h3>
          <p className="text-sm font-semibold text-slate-500 mb-8 leading-relaxed px-2 max-w-sm">
            {message}
          </p>
          
          {/* Action buttons list */}
          <div className="flex w-full gap-3 pt-2">
            {type === 'confirm' && (
              <button
                onClick={onClose}
                className="flex-1 h-14 bg-[#85cc00]/10 hover:bg-[#85cc00] border-2 border-[#85cc00]/20 text-slate-600 hover:text-slate-950 font-extrabold text-[11px] uppercase tracking-widest rounded-2xl active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer"
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={() => {
                if (onConfirm) onConfirm();
                onClose();
              }}
              className={`flex-1 h-14 font-extrabold text-[11px] uppercase tracking-widest rounded-2xl active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer ${theme.buttonStyles}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
