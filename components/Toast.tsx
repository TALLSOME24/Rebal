"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastVariant = "success" | "error" | "pending" | "info";

type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastContextType = {
  toast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), toast.variant === "pending" ? 15_000 : 4_000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.variant, onRemove]);

  const styles: Record<ToastVariant, string> = {
    success: "border-green/30 bg-green/10 text-green",
    error: "border-[#FF4757]/30 bg-[#FF4757]/10 text-[#FF4757]",
    pending: "border-primary/30 bg-primary/10 text-primary",
    info: "border-white/10 bg-white/5 text-white/80",
  };

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm text-sm ${styles[toast.variant]}`}
      style={{ animation: "slideIn 0.2s ease-out" }}
    >
      {toast.variant === "pending" && (
        <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
      )}
      {toast.variant === "success" && <span className="shrink-0">✓</span>}
      {toast.variant === "error" && <span className="shrink-0">✕</span>}
      <span>{toast.message}</span>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = `toast-${++counterRef.current}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, variant }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm w-full">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={remove} />
        ))}
      </div>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
