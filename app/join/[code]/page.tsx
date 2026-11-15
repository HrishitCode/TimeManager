"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import type { Me } from "@/lib/shared/types";

interface InviteInfo {
  workspace_name: string;
  inviter: string | null;
  valid: boolean;
}

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<InviteInfo>(`/api/invites/${encodeURIComponent(code)}`).then(setInfo, (e) => setError(errMsg(e)));
    api<Me>("/api/me").then(setMe, () => setMe(null));
  }, [code]);

  const join = async () => {
    setBusy(true);
    try {
      await api("/api/workspace/join", { body: { code } });
      location.href = "/together";
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <main className="page-narrow">
      <div className="auth-brand">
        <div className="brand">
          <span className="brand-dot" />
          Time Manager
        </div>
      </div>
      <div className="card stack" style={{ textAlign: "center" }}>
        {info ? (
          <>
            <p className="muted">{info.inviter ? `${info.inviter} invited you to` : "You're invited to"}</p>
            <h1>{info.workspace_name}</h1>
            <p className="muted small">Share calendars, plan study sessions together, and compare how you each managed your time.</p>
            {!info.valid ? (
              <div className="callout warn">This invite has expired or was already used. Ask for a new link.</div>
            ) : me === undefined ? null : me ? (
              me.workspace ? (
                <div className="callout warn">
                  You&apos;re already in <strong>{me.workspace.name}</strong>. Leave it from the Together page to join this one.
                </div>
              ) : (
                <button className="primary lg" onClick={() => void join()} disabled={busy}>
                  Join as {me.user.name}
                </button>
              )
            ) : (
              <div className="stack">
                <Link href={`/signup?invite=${code}`}>
                  <button className="primary lg block">Create account &amp; join</button>
                </Link>
                <Link href={`/login?invite=${code}`}>
                  <button className="block">I already have an account</button>
                </Link>
              </div>
            )}
          </>
        ) : error ? null : (
          <p className="muted">Loading invite…</p>
        )}
        {error ? <div className="callout bad">{error}</div> : null}
      </div>
    </main>
  );
}
