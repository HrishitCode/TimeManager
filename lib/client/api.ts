"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown>) {
    super(message);
  }
}

export const api = async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    cache: "no-store"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !location.pathname.startsWith("/login") && !location.pathname.startsWith("/signup") && !location.pathname.startsWith("/join")) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`, data);
  }
  return data as T;
};

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/**
 * Minimal SWR: fetch on mount/key change, optional polling, refetch when the tab regains focus.
 * Cross-device sync is just this — every device re-reads the server of record.
 */
export const useApi = <T>(path: string | null, opts: { refreshMs?: number } = {}) => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (pathRef.current === p) setError(errMsg(e));
    } finally {
      if (pathRef.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    void reload();
  }, [path, reload]);

  useEffect(() => {
    if (!path) return;
    const onFocus = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    const id = opts.refreshMs
      ? window.setInterval(() => document.visibilityState === "visible" && void reload(), opts.refreshMs)
      : undefined;
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      if (id) window.clearInterval(id);
    };
  }, [path, opts.refreshMs, reload]);

  return { data, error, loading, reload, setData };
};

/** Re-render every `ms` (for ticking clocks). */
export const useNow = (ms = 1000) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
};
