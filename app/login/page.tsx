"use client";

import { FormEvent, useMemo, useState } from "react";
import { createSupabaseBrowserClient, hasBrowserSupabaseEnv } from "@/lib/supabase/client";

export default function LoginPage() {
  const isConfigured = hasBrowserSupabaseEnv();
  const supabase = useMemo(
    () => (isConfigured ? createSupabaseBrowserClient() : null),
    [isConfigured]
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setError("");
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      setError(loginError.message);
      return;
    }
    window.location.href = "/";
  };

  return (
    <main>
      {isConfigured ? (
        <form onSubmit={onSubmit} className="card" style={{ maxWidth: 480, margin: "2rem auto", display: "grid", gap: 8 }}>
          <h1>Login</h1>
          <label>Email</label>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <label>Password</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {error ? <p style={{ color: "#bf4342" }}>{error}</p> : null}
          <button className="primary" type="submit">
            Login
          </button>
        </form>
      ) : (
        <div className="card" style={{ maxWidth: 640, margin: "2rem auto" }}>
          <h1>Supabase Setup Required</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code>.
          </p>
        </div>
      )}
    </main>
  );
}
