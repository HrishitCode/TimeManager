"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MeContext, useMe } from "@/components/MeContext";
import { Spinner, ThemeToggle, ToastProvider, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/client/api";
import { notify } from "@/lib/client/notify";
import { fmtTime } from "@/lib/shared/time";
import type { Block, Me, Timer } from "@/lib/shared/types";

const NAV = [
  { href: "/", label: "Today", ico: "◉" },
  { href: "/plan", label: "Plan", ico: "▦" },
  { href: "/tasks", label: "Tasks", ico: "✓" },
  { href: "/reports", label: "Reports", ico: "▲" },
  { href: "/together", label: "Together", ico: "◎" }
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const reloadMe = useCallback(async () => setMe(await api<Me>("/api/me")), []);
  useEffect(() => {
    void reloadMe().catch(() => undefined);
  }, [reloadMe]);
  const ctx = useMemo(() => (me ? { me, reloadMe } : null), [me, reloadMe]);

  if (!ctx) return <Spinner />;
  return (
    <MeContext.Provider value={ctx}>
      <ToastProvider>
        <Shell>{children}</Shell>
      </ToastProvider>
    </MeContext.Provider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const toast = useToast();

  // Upcoming blocks power the invitation badge and start-of-block reminders.
  const range = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    return `from=${from.toISOString()}&to=${new Date(from.getTime() + 21 * 86_400_000).toISOString()}`;
  }, []);
  const { data: blocks } = useApi<Block[]>(`/api/blocks?${range}`, { refreshMs: 60_000 });
  const { me } = useMe();
  const invites = (blocks ?? []).filter((b) =>
    b.participants.some((p) => p.user_id === me.user.id && p.status === "invited") && new Date(b.ends_at) > new Date()
  ).length;

  useBlockReminders(blocks, me.user.id, toast);

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST", body: {} });
    location.href = "/login";
  };

  const links = NAV.map((n) => {
    const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
    return (
      <Link key={n.href} href={n.href} className={`navlink ${active ? "active" : ""}`}>
        <span className="ico">{n.ico}</span>
        {n.label}
        {n.href === "/plan" && invites > 0 ? <span className="badge">{invites}</span> : null}
      </Link>
    );
  });

  return (
    <>
      <header className="topnav">
        <div className="topnav-inner">
          <Link href="/" className="brand">
            <span className="brand-dot" />
            Time Manager
          </Link>
          <nav className="navlinks">{links}</nav>
          <div className="nav-right">
            <ThemeToggle />
            <button className="ghost sm" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      {children}
      <nav className="bottomnav">{links}</nav>
    </>
  );
}

/** When one of my blocks starts and I'm not tracking it, nudge me (toast + system notification if allowed). */
function useBlockReminders(blocks: Block[] | undefined, myId: string | undefined, toast: ReturnType<typeof useToast>) {
  const fired = useRef(new Set<string>());
  useEffect(() => {
    if (!blocks || !myId) return;
    const check = async () => {
      const now = Date.now();
      const due = blocks.filter((b) => {
        const s = new Date(b.starts_at).getTime();
        const mine = b.participants.some((p) => p.user_id === myId && p.status === "accepted");
        return mine && now >= s && now - s < 5 * 60_000 && !fired.current.has(b.id);
      });
      if (!due.length) return;
      const { timer } = await api<{ timer: Timer | null }>("/api/timer").catch(() => ({ timer: null }));
      for (const b of due) {
        fired.current.add(b.id);
        if (timer?.status === "running" && timer.block_id === b.id) continue;
        const text = `"${b.title}" started at ${fmtTime(b.starts_at)}`;
        toast({
          text,
          action: {
            label: "Start timer",
            run: () => {
              void api("/api/timer", {
                body: { action: "start", block_id: b.id, label: b.title, project_id: b.owner_id === myId ? b.project_id : null, task_id: b.owner_id === myId ? b.task_id : null, planned_sec: Math.round((new Date(b.ends_at).getTime() - now) / 1000) }
              }).then(() => (location.pathname === "/" ? location.reload() : (location.href = "/")));
            }
          }
        });
        if (document.visibilityState !== "visible") void notify("Time to start", text, { tag: b.id, url: "/" });
      }
    };
    void check();
    const id = window.setInterval(() => void check(), 30_000);
    return () => window.clearInterval(id);
  }, [blocks, myId, toast]);
}
