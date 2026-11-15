"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMe, usePeople } from "@/components/MeContext";
import { Avatar, useToast } from "@/components/ui";
import { api, errMsg } from "@/lib/client/api";

export default function TogetherPage() {
  const { me, reloadMe } = useMe();
  const people = usePeople();
  const toast = useToast();
  const [wsName, setWsName] = useState("");
  const [code, setCode] = useState("");
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const flash = sessionStorage.getItem("flash");
      if (flash) {
        setError(flash);
        sessionStorage.removeItem("flash");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError("");
    try {
      await fn();
      await reloadMe();
      if (ok) toast({ text: ok });
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api("/api/workspace", { body: { name: wsName.trim() || `${me.user.name}'s workspace` } }), "Workspace created");
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api("/api/workspace/join", { body: { code } }), "Joined!");
  };
  const makeInvite = () => run(async () => setInvite(await api("/api/workspace/invite", { body: {} })));
  const link = invite ? `${location.origin}/join/${invite.code}` : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ text: "Link copied" });
    } catch {
      toast({ text: "Couldn't copy — select the link and copy it manually" });
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Together</h1>
          <p className="muted small">Share a workspace: see each other&apos;s calendars, plan sessions together, compare reports.</p>
        </div>
      </div>
      {error ? <div className="callout bad" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="grid-2">
        {me.workspace ? (
          <section className="card">
            <div className="card-head">
              <h2>{me.workspace.name}</h2>
              <span className="chip">{me.workspace.members.length} member{me.workspace.members.length === 1 ? "" : "s"}</span>
            </div>
            <div className="stack">
              {people.map((p) => (
                <div key={p.id} className="person">
                  <Avatar name={p.name} color={p.color} />
                  <div className="grow">
                    <div className="strong">
                      {p.name} {p.isMe ? <span className="muted small">(you)</span> : null}
                    </div>
                    <div className="tiny muted">
                      {p.role} · {p.timezone}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="divider" />
            <h3 style={{ marginBottom: 8 }}>Invite your study partner</h3>
            {invite ? (
              <div className="stack">
                <div className="callout">
                  <div className="tiny muted">Send them this link (single use, valid 14 days)</div>
                  <div className="strong" style={{ wordBreak: "break-all", userSelect: "all" }}>{link}</div>
                  <div className="tiny muted" style={{ marginTop: 4 }}>
                    or the code <code>{invite.code}</code>
                  </div>
                </div>
                <div className="row">
                  <button className="primary sm" onClick={() => void copyLink()}>
                    Copy link
                  </button>
                  <button className="sm" onClick={() => void makeInvite()}>
                    New link
                  </button>
                </div>
              </div>
            ) : (
              <button className="primary" onClick={() => void makeInvite()}>
                Create invite link
              </button>
            )}
            <div className="divider" />
            {confirmLeave ? (
              <div className="callout bad stack">
                <span className="small">
                  Leave <strong>{me.workspace.name}</strong>? Your own data stays; you&apos;ll stop seeing each other&apos;s calendars and reports.
                  {me.workspace.members.length === 1 ? " The workspace will be deleted." : ""}
                </span>
                <div className="row">
                  <button className="danger sm" onClick={() => void run(() => api("/api/workspace", { method: "DELETE" }), "You left the workspace").then(() => setConfirmLeave(false))}>
                    Yes, leave
                  </button>
                  <button className="sm ghost" onClick={() => setConfirmLeave(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="danger sm" onClick={() => setConfirmLeave(true)}>
                Leave workspace
              </button>
            )}
          </section>
        ) : (
          <section className="card stack">
            <h2>Start a workspace</h2>
            <p className="muted small">Create one, then send your partner the invite link.</p>
            <form className="row" onSubmit={create}>
              <input placeholder="e.g. DSA grind" value={wsName} onChange={(e) => setWsName(e.target.value)} />
              <button className="primary">Create</button>
            </form>
            <div className="divider" />
            <h2>Have a code?</h2>
            <form className="row" onSubmit={join}>
              <input placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ textTransform: "uppercase", letterSpacing: "0.1em" }} />
              <button disabled={code.trim().length < 4}>Join</button>
            </form>
          </section>
        )}
        <ProfileCard />
      </div>
    </main>
  );
}

function ProfileCard() {
  const { me, reloadMe } = useMe();
  const toast = useToast();
  const [name, setName] = useState(me.user.name);
  const [tz, setTz] = useState(me.user.timezone);
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    } catch {
      return [me.user.timezone];
    }
  }, [me.user.timezone]);
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/me", { method: "PATCH", body: { name, timezone: tz } });
      await reloadMe();
      toast({ text: "Profile saved" });
    } catch (err) {
      toast({ text: errMsg(err), kind: "bad" });
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Your profile</h2>
      </div>
      <form className="fields" onSubmit={save}>
        <div>
          <label>Email</label>
          <input value={me.user.email} disabled />
        </div>
        <div>
          <label htmlFor="p-name">Name</label>
          <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>
        <div>
          <label htmlFor="p-tz">Time zone</label>
          <select id="p-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
            {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <p className="tiny muted" style={{ marginTop: 4 }}>
            Defines where your day starts and ends in reports.
            {browserTz && browserTz !== tz ? (
              <>
                {" "}
                This device is on <button type="button" className="ghost sm" style={{ padding: "0 4px" }} onClick={() => setTz(browserTz)}>{browserTz}</button>.
              </>
            ) : null}
          </p>
        </div>
        <button className="primary">Save</button>
      </form>
    </section>
  );
}
