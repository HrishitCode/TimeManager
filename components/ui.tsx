"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// ───────────── modal ─────────────
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2>{title}</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ───────────── toasts ─────────────
interface ToastItem {
  id: number;
  text: string;
  kind?: "bad";
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(t: Omit<ToastItem, "id">) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.action ? 12_000 : 4_000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind ?? ""}`}>
            <span>{t.text}</span>
            {t.action ? (
              <button
                className="sm"
                onClick={() => {
                  t.action!.run();
                  setItems((xs) => xs.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ───────────── people ─────────────
const PALETTE = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)"];
export const colorAt = (i: number) => PALETTE[i % PALETTE.length];

export function Avatar({ name, color, small }: { name: string; color: string; small?: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className={`avatar ${small ? "sm" : ""}`} style={{ background: color }} aria-hidden>
      {initials}
    </span>
  );
}

// ───────────── theme ─────────────
export function ThemeToggle() {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  useEffect(() => {
    const t = (() => {
      try {
        return localStorage.getItem("theme");
      } catch {
        return null;
      }
    })();
    if (t === "light" || t === "dark") setTheme(t);
  }, []);
  const cycle = () => {
    const next = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
    setTheme(next);
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  };
  return (
    <button className="ghost icon" onClick={cycle} title={`Theme: ${theme}`} aria-label={`Theme: ${theme}`}>
      {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}
    </button>
  );
}

export function Spinner() {
  return <div className="muted small" style={{ padding: 24, textAlign: "center" }}>Loading…</div>;
}
