"use client";

import { cn } from "@/lib/utils";
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type ToastType = "success" | "warning" | "error" | "info";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  dismiss: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...t, id }]);
    if (t.duration !== 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, t.duration ?? 5000);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const icons: Record<ToastType, React.ComponentType<{ className?: string }>> = {
    success: CheckCircle,
    warning: AlertTriangle,
    error: AlertCircle,
    info: Info,
  };

  const colors: Record<ToastType, string> = {
    success: "border-success-500 bg-success-50 dark:bg-success-900/30",
    warning: "border-warning-500 bg-warning-50 dark:bg-warning-900/30",
    error: "border-danger-500 bg-danger-50 dark:bg-danger-900/30",
    info: "border-info-500 bg-info-50 dark:bg-info-900/30",
  };

  const iconColors: Record<ToastType, string> = {
    success: "text-success-600",
    warning: "text-warning-600",
    error: "text-danger-600",
    info: "text-info-600",
  };

  const Icon = icons[t.type];

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg border shadow-lg animate-slide-up",
        colors[t.type],
      )}
    >
      <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", iconColors[t.type])} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{t.title}</p>
        {t.description && (
          <p className="text-sm text-text-secondary mt-0.5">{t.description}</p>
        )}
      </div>
      <button onClick={onDismiss} className="shrink-0 text-text-tertiary hover:text-text-primary">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
