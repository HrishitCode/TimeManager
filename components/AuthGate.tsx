"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient, hasBrowserSupabaseEnv } from "@/lib/supabase/client";
import SignOutButton from "@/components/SignOutButton";

interface Props {
  children: (args: { token: string; email: string }) => React.ReactNode;
}

export default function AuthGate({ children }: Props) {
  const isConfigured = hasBrowserSupabaseEnv();
  const supabase = useMemo(
    () => (isConfigured ? createSupabaseBrowserClient() : null),
    [isConfigured]
  );
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    if (!supabase) {
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
      setEmail(data.session?.user.email ?? "");
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_, session) => {
      setToken(session?.access_token ?? null);
      setEmail(session?.user.email ?? "");
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  if (!isConfigured) {
    return (
      <main>
        <div className="card" style={{ maxWidth: 640, margin: "2rem auto" }}>
          <h1>Supabase Setup Required</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Add these values to <code>.env.local</code> and restart <code>npm run dev</code>:
          </p>
          <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
{`NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...`}
          </pre>
        </div>
      </main>
    );
  }

  if (!token) {
    return (
      <main>
        <div className="card" style={{ maxWidth: 480, margin: "2rem auto" }}>
          <h1>Personalized Pomodoro</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Sign in to sync timer state across devices.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <Link href="/login">
              <button className="primary">Login</button>
            </Link>
            <Link href="/signup">
              <button className="ghost">Create account</button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="floating-control right">
        <SignOutButton />
      </div>
      {children({ token, email })}
    </>
  );
}
