"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient, hasBrowserSupabaseEnv } from "@/lib/supabase/client";

export default function SignupPage() {
  const isConfigured = hasBrowserSupabaseEnv();
  const supabase = useMemo(
    () => (isConfigured ? createSupabaseBrowserClient() : null),
    [isConfigured]
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setError("");
    setNotice("");
    const { data, error: signupError } = await supabase.auth.signUp({ email, password });
    if (signupError) {
      setError(signupError.message);
      return;
    }

    if (data.user && !data.session) {
      setNotice("Confirmation email sent. Please check your inbox and verify your email before logging in.");
      return;
    }

    if (data.user && data.session) {
      setNotice("Account created successfully. You can login now.");
    }
  };

  return (
    <main>
      {isConfigured ? (
        <form onSubmit={onSubmit} className="card" style={{ maxWidth: 480, margin: "2rem auto", display: "grid", gap: 8 }}>
          <h1>Create account</h1>
          <label>Email</label>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <label>Password</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} />
          {error ? <p style={{ color: "#bf4342" }}>{error}</p> : null}
          {notice ? (
            <div style={{ display: "grid", gap: 8 }}>
              <p style={{ color: "#2364aa" }}>{notice}</p>
              <Link href="/login">
                <button type="button" className="ghost">
                  Go to login
                </button>
              </Link>
            </div>
          ) : null}
          <button className="primary" type="submit">
            Sign up
          </button>
          <p className="muted" style={{ fontSize: 14 }}>
            Already have an account? <Link href="/login">Login</Link>
          </p>
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
