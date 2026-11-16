"use client";

import { FormEvent, useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { fmtTime, localDate } from "@/lib/shared/time";
import { Avatar, Modal, useToast } from "./ui";
import { useMe, usePeople } from "./MeContext";
import type { Block, Project, Task } from "@/lib/shared/types";

export interface BlockDraft {
  date: string;
  start: string; // HH:MM
  end: string; // HH:MM
  title?: string;
  project_id?: string | null;
  task_id?: string | null;
  invite?: string[];
}

interface Props {
  draft?: BlockDraft;
  block?: Block;
  projects: Project[];
  tasks: Task[];
  onClose: () => void;
  onSaved: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (date: string, time: string, addDay = false) => {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, m - 1, d + (addDay ? 1 : 0), h, mi).toISOString();
};

export default function BlockEditor({ draft, block, projects, tasks, onClose, onSaved }: Props) {
  const { me } = useMe();
  const people = usePeople();
  const toast = useToast();
  const mine = !block || block.owner_id === me.user.id;
  const myStatus = block?.participants.find((p) => p.user_id === me.user.id)?.status;

  const [title, setTitle] = useState(block?.title ?? draft?.title ?? "");
  const [date, setDate] = useState(block ? localDate(new Date(block.starts_at)) : draft!.date);
  const [start, setStart] = useState(block ? hhmm(block.starts_at) : draft!.start);
  const [end, setEnd] = useState(block ? hhmm(block.ends_at) : draft!.end);
  const [projectId, setProjectId] = useState(block?.project_id ?? draft?.project_id ?? "");
  const [taskId, setTaskId] = useState(block?.task_id ?? draft?.task_id ?? "");
  const already = new Set(block?.participants.filter((p) => p.status !== "declined").map((p) => p.user_id) ?? []);
  const [invite, setInvite] = useState<string[]>(draft?.invite ?? []);
  const [include, setInclude] = useState(block?.include_in_reports ?? true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const mates = people.filter((p) => !p.isMe);
  const openTasks = tasks.filter((t) => t.status === "todo" && (!projectId || t.project_id === projectId));

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (done) toast({ text: done });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const startsAt = toIso(date, start);
    const endsAt = toIso(date, end, end <= start); // "23:00 → 00:30" means past midnight
    const payload = {
      title: title.trim() || projects.find((p) => p.id === projectId)?.name || "Focus",
      starts_at: startsAt,
      ends_at: endsAt,
      project_id: projectId || null,
      task_id: taskId || null,
      include_in_reports: include
    };
    if (!block) {
      return run(() => api("/api/blocks", { body: { ...payload, invite_user_ids: invite } }), invite.length ? "Planned & invitation sent" : "Planned");
    }
    return run(async () => {
      await api(`/api/blocks/${block.id}`, { method: "PATCH", body: payload });
      const newInvites = invite.filter((id) => !already.has(id));
      if (newInvites.length) await api(`/api/blocks/${block.id}/invite`, { body: { user_ids: newInvites } });
    }, "Saved");
  };

  const heading = !block ? "Plan a block" : mine ? "Edit block" : myStatus === "invited" ? "Invitation" : "Shared block";

  return (
    <Modal title={heading} onClose={onClose}>
      {block && !mine ? (
        <div className="stack">
          <div>
            <h2>{block.title}</h2>
            <p className="muted small">
              {new Date(block.starts_at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })} · {fmtTime(block.starts_at)}–{fmtTime(block.ends_at)}
            </p>
            <p className="small" style={{ marginTop: 6 }}>
              Organised by <strong>{block.owner_name}</strong>
              {!block.include_in_reports ? <span className="chip" style={{ marginLeft: 8 }}>not counted in reports</span> : null}
            </p>
          </div>
          <Participants block={block} />
          {error ? <div className="callout bad">{error}</div> : null}
          {myStatus === "invited" ? (
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => void run(() => api(`/api/blocks/${block.id}/respond`, { body: { status: "accepted" } }), "Accepted — it's on your calendar")}>
                Accept
              </button>
              <button disabled={busy} onClick={() => void run(() => api(`/api/blocks/${block.id}/respond`, { body: { status: "declined" } }), "Declined")}>
                Decline
              </button>
            </div>
          ) : myStatus === "accepted" ? (
            <button className="danger" disabled={busy} onClick={() => void run(() => api(`/api/blocks/${block.id}`, { method: "DELETE" }), "You left this block")}>
              Leave this block
            </button>
          ) : (
            <p className="muted small">This is on {block.owner_name}&apos;s calendar.</p>
          )}
        </div>
      ) : (
        <form className="fields" onSubmit={save}>
          <div>
            <label htmlFor="b-title">What</label>
            <input id="b-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. DSA — graphs" autoFocus />
          </div>
          <div className="fields-3">
            <div>
              <label htmlFor="b-date">Day</label>
              <input id="b-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="b-start">From</label>
              <input id="b-start" type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="b-end">To</label>
              <input id="b-end" type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          <div className="fields-2">
            <div>
              <label htmlFor="b-project">Project</label>
              <select id="b-project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId(""); }}>
                <option value="">None</option>
                {projects.filter((p) => !p.archived_at || p.id === projectId).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="b-task">Task</label>
              <select id="b-task" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">None</option>
                {openTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="inline">
              <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} />
              Count this time in reports
            </label>
            {!include ? (
              <p className="tiny muted" style={{ marginTop: 4, marginLeft: 24 }}>
                Left out entirely: this window won&apos;t count as planned, and anything you track during it won&apos;t count as focus. Good for office hours, commute, sleep.
              </p>
            ) : null}
          </div>
          {mates.length ? (
            <div>
              <label>Study together</label>
              <div className="stack" style={{ gap: 6 }}>
                {mates.map((m) => {
                  const status = block?.participants.find((p) => p.user_id === m.id)?.status;
                  const locked = status === "accepted" || status === "invited";
                  return (
                    <label key={m.id} className="inline">
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={locked || invite.includes(m.id)}
                        onChange={(e) => setInvite((xs) => (e.target.checked ? [...xs, m.id] : xs.filter((x) => x !== m.id)))}
                      />
                      <Avatar name={m.name} color={m.color} small /> Invite {m.name}
                      {status ? <span className={`chip ${status === "accepted" ? "good" : status === "declined" ? "bad" : ""}`}>{status}</span> : null}
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
          {error ? <div className="callout bad">{error}</div> : null}
          <div className="row between">
            {block ? (
              <button type="button" className="danger" disabled={busy} onClick={() => void run(() => api(`/api/blocks/${block.id}`, { method: "DELETE" }), "Deleted")}>
                Delete
              </button>
            ) : (
              <span />
            )}
            <div className="row">
              <button type="button" className="ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {block ? "Save" : "Add to plan"}
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Participants({ block }: { block: Block }) {
  const people = usePeople();
  return (
    <div className="stack" style={{ gap: 6 }}>
      {block.participants.map((p) => {
        const person = people.find((x) => x.id === p.user_id);
        return (
          <div key={p.user_id} className="row">
            <Avatar name={p.name} color={person?.color ?? "var(--muted)"} small />
            <span className="small grow">{person?.isMe ? "You" : p.name}</span>
            <span className={`chip ${p.status === "accepted" ? "good" : p.status === "declined" ? "bad" : ""}`}>{p.status}</span>
          </div>
        );
      })}
    </div>
  );
}
