import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'warning';
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const styles = {
    success: {
      bg: 'bg-white/90',
      border: 'border-emerald-200/50',
      text: 'text-slate-900',
      icon: 'text-emerald-500',
      shadow: 'shadow-emerald-500/10',
    },
    error: {
      bg: 'bg-white/90',
      border: 'border-rose-200/50',
      text: 'text-slate-900',
      icon: 'text-rose-500',
      shadow: 'shadow-rose-500/10',
    },
    warning: {
      bg: 'bg-white/90',
      border: 'border-amber-200/50',
      text: 'text-slate-900',
      icon: 'text-amber-500',
      shadow: 'shadow-amber-500/10',
    },
  }[type];

  const icon = {
    success: <CheckCircle2 className={`w-6 h-6 ${styles.icon}`} />,
    error: <AlertCircle className={`w-6 h-6 ${styles.icon}`} />,
    warning: <Info className={`w-6 h-6 ${styles.icon}`} />,
  }[type];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95, x: '-50%' }}
        animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
        exit={{ opacity: 0, y: -20, scale: 0.95, x: '-50%' }}
        className={`fixed top-8 left-1/2 z-[100] flex items-center gap-4 px-6 py-4 rounded-3xl border ${styles.border} ${styles.bg} ${styles.shadow} shadow-2xl backdrop-blur-xl min-w-[360px] max-w-lg`}
      >
        {icon}
        <p className={`text-sm font-semibold flex-1 ${styles.text} leading-snug`}>{message}</p>
        <button 
          onClick={onClose} 
          className="p-1.5 hover:bg-slate-100 rounded-full transition-all text-slate-400 hover:text-slate-600"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
};
