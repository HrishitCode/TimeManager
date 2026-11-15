"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, errMsg } from "@/lib/client/api";

const param = (k: string) => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(k));

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [next, setNext] = useState("/");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setSearch(window.location.search);
    setInvite(param("invite"));
    const n = param("next");
    if (n && n.startsWith("/") && !n.startsWith("//")) setNext(n);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") {
        await api("/api/auth/signup", {
          body: { email, name, password, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        });
      } else {
        await api("/api/auth/login", { body: { email, password } });
      }
      if (invite) {
        try {
          await api("/api/workspace/join", { body: { code: invite } });
          location.href = "/together";
          return;
        } catch (err) {
          alertLater(errMsg(err));
        }
      }
      location.href = next;
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  const otherHref = `${mode === "login" ? "/signup" : "/login"}${search}`;

  return (
    <main className="page-narrow">
      <div className="auth-brand">
        <div className="brand">
          <span className="brand-dot" />
          Time Manager
        </div>
        <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          {invite ? "Sign in to join your partner's workspace." : "Plan the day. Track it honestly. Grow together."}
        </p>
      </div>
      <form className="card fields" onSubmit={submit}>
        {mode === "signup" ? (
          <div>
            <label htmlFor="name">Your name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required maxLength={60} />
          </div>
        ) : null}
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 8 : undefined}
            required
          />
          {mode === "signup" ? <p className="tiny muted" style={{ marginTop: 4 }}>At least 8 characters.</p> : null}
        </div>
        {error ? <div className="callout bad">{error}</div> : null}
        <button className="primary lg" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="muted small" style={{ textAlign: "center", marginTop: 16 }}>
        {mode === "login" ? "New here? " : "Already have an account? "}
        <Link className="link" href={otherHref}>
          {mode === "login" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </main>
  );
}

const alertLater = (msg: string) => {
  try {
    sessionStorage.setItem("flash", msg);
  } catch {
    /* ignore */
  }
};
