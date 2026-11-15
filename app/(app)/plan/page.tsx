"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import BlockEditor, { BlockDraft } from "@/components/BlockEditor";
import { Person, useMe, usePeople } from "@/components/MeContext";
import { Avatar, useToast } from "@/components/ui";
import { api, errMsg, useApi, useNow } from "@/lib/client/api";
import { useCatalog } from "@/lib/client/catalog";
import { addDays, fmtDuration, fmtTime, localDate } from "@/lib/shared/time";
import type { Block, MemberStatus, TimeEntry } from "@/lib/shared/types";

const PX = 1; // pixels per minute → 1440px per day
const GUTTER = 48;
const pad = (n: number) => String(n).padStart(2, "0");
const toHHMM = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const midnight = (date: string) => new Date(`${date}T00:00`).getTime();

export default function PlanPage() {
  const { me } = useMe();
  const people = usePeople();
  const catalog = useCatalog();
  const toast = useToast();
  const now = useNow(60_000);
  const [date, setDate] = useState(() => localDate());
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  const [open, setOpen] = useState<Block | null>(null);

  // URL ↔ state (?date=YYYY-MM-DD&task=<id>)
  const [taskParam, setTaskParam] = useState<string | null>(null);
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const d = sp.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d);
    setTaskParam(sp.get("task"));
    setUrlRead(true);
  }, []);
  useEffect(() => {
    if (urlRead) history.replaceState(null, "", `/plan?date=${date}`);
  }, [date, urlRead]);

  const dayStart = midnight(date);
  const dayEnd = midnight(addDays(date, 1));
  const range = `from=${new Date(dayStart).toISOString()}&to=${new Date(dayEnd).toISOString()}`;
  const blocks = useApi<Block[]>(`/api/blocks?${range}`, { refreshMs: 30_000 });
  const status = useApi<MemberStatus[]>("/api/status", { refreshMs: 15_000 });

  // Tracked time per person (what actually happened), for the "plan vs. reality" stripe.
  const [entries, setEntries] = useState<Record<string, TimeEntry[]>>({});
  const loadEntries = useCallback(async () => {
    const pairs = await Promise.all(
      people.map(async (p) => [p.id, await api<TimeEntry[]>(`/api/entries?${range}&user_id=${p.id}`).catch(() => [])] as const)
    );
    setEntries(Object.fromEntries(pairs));
  }, [people.map((p) => p.id).join(","), range]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void loadEntries();
    const id = window.setInterval(() => void loadEntries(), 60_000);
    return () => window.clearInterval(id);
  }, [loadEntries]);

  const reloadAll = () => {
    void blocks.reload();
    void loadEntries();
  };

  // Deep link from Tasks: open a draft for that task.
  useEffect(() => {
    if (!taskParam || !catalog.loaded) return;
    const t = catalog.tasks.find((x) => x.id === taskParam);
    setTaskParam(null);
    if (!t) return;
    const startMin = date === localDate() ? Math.min(23 * 60, Math.ceil((new Date().getHours() * 60 + new Date().getMinutes()) / 15) * 15) : 9 * 60;
    setDraft({ date, start: toHHMM(startMin), end: toHHMM(Math.min(24 * 60 - 5, startMin + (t.estimate_min ?? 60))), title: t.title, project_id: t.project_id, task_id: t.id });
  }, [taskParam, catalog.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to a sensible hour on open/date change.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const isToday = date === localDate();
    const min = isToday ? new Date().getHours() * 60 - 90 : 7 * 60;
    el.scrollTop = Math.max(0, min * PX);
  }, [date]);

  const copy = async (direction: "from-prev" | "to-next") => {
    const from = direction === "from-prev" ? addDays(date, -1) : date;
    const to = direction === "from-prev" ? date : addDays(date, 1);
    try {
      const res = await api<{ copied: number; skipped: number }>("/api/blocks/copy", {
        body: {
          from_start: new Date(midnight(from)).toISOString(),
          from_end: new Date(midnight(addDays(from, 1))).toISOString(),
          to_start: new Date(midnight(to)).toISOString()
        }
      });
      toast({ text: `Copied ${res.copied} block${res.copied === 1 ? "" : "s"}${res.skipped ? ` · ${res.skipped} skipped (clash)` : ""}` });
      if (direction === "to-next") setDate(to);
      else reloadAll();
    } catch (e) {
      toast({ text: errMsg(e), kind: "bad" });
    }
  };

  const columns = people.map((p) => ({
    person: p,
    // Accepted blocks, plus pending invitations (drawn hatched) so both sides see what's proposed.
    blocks: (blocks.data ?? []).filter((b) => b.participants.some((x) => x.user_id === p.id && x.status !== "declined")),
    entries: entries[p.id] ?? [],
    running: status.data?.find((s) => s.user_id === p.id)?.timer ?? null
  }));

  const myPlanned = columns[0]?.blocks
    .filter((b) => b.participants.some((x) => x.user_id === me.user.id && x.status === "accepted"))
    .reduce((s, b) => s + (Math.min(dayEnd, new Date(b.ends_at).getTime()) - Math.max(dayStart, new Date(b.starts_at).getTime())) / 60_000, 0);

  const isToday = date === localDate(new Date(now));
  const nowMin = (now - dayStart) / 60_000;
  const grid = `${GUTTER}px repeat(${columns.length}, minmax(0, 1fr))`;
  const label = new Date(dayStart).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

  const clickColumn = (person: Person, e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const y = e.nativeEvent.offsetY;
    const start = Math.max(0, Math.min(24 * 60 - 15, Math.floor(y / PX / 15) * 15));
    setDraft({ date, start: toHHMM(start), end: toHHMM(Math.min(24 * 60 - 5, start + 60)), invite: person.isMe ? [] : [person.id] });
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{label}</h1>
          <p className="muted small num">
            {myPlanned ? `${fmtDuration(myPlanned)} planned for you` : "Tap an empty slot to plan a block"}
            {people.length > 1 ? " · tap a partner's column to invite them" : ""}
          </p>
        </div>
        <div className="row wrap">
          <div className="row" style={{ gap: 4 }}>
            <button className="icon" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
              ←
            </button>
            <button className={isToday ? "dark sm" : "sm"} onClick={() => setDate(localDate())}>
              Today
            </button>
            <button className="sm" onClick={() => setDate(addDays(localDate(), 1))}>
              Tomorrow
            </button>
            <button className="icon" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
              →
            </button>
          </div>
          <input className="hide-mobile" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 150 }} aria-label="Pick a date" />
        </div>
      </div>

      <div className="row wrap between" style={{ marginBottom: 10 }}>
        <div className="row wrap">
          <button className="primary sm" onClick={() => setDraft({ date, start: isToday ? toHHMM(Math.ceil(nowMin / 15) * 15 % 1440) : "09:00", end: isToday ? toHHMM(Math.min(1435, Math.ceil(nowMin / 15) * 15 + 60)) : "10:00" })}>
            + Block
          </button>
          <button className="sm" onClick={() => void copy("from-prev")} title="Copy your blocks from the previous day into this day">
            Copy previous day
          </button>
          <button className="sm" onClick={() => void copy("to-next")} title="Copy this day's blocks to the next day">
            Copy to next day
          </button>
        </div>
        <div className="cal-legend hide-mobile" style={{ marginTop: 0 }}>
          <span><i className="swatch" style={{ background: "color-mix(in srgb, var(--p1) 25%, var(--surface))", borderLeft: "3px solid var(--p1)" }} /> planned</span>
          <span><i className="swatch" style={{ background: "var(--good)", width: 5 }} /> tracked focus</span>
          <span><i className="swatch" style={{ outline: "1.5px dashed var(--p1)", outlineOffset: -1.5 }} /> invitation</span>
        </div>
      </div>

      <div className="cal">
        <div className="cal-scroll" ref={scroller}>
        <div className="cal-head" style={{ gridTemplateColumns: grid }}>
          <div />
          {columns.map(({ person, entries: es }) => {
            const focus = es.filter((x) => x.mode === "focus").reduce((s, x) => s + (new Date(x.ended_at).getTime() - new Date(x.started_at).getTime()) / 60_000, 0);
            return (
              <div key={person.id}>
                <Avatar name={person.name} color={person.color} small />
                <span className="ellipsis">{person.label}</span>
                {focus > 0 ? <span className="muted tiny num">{fmtDuration(focus)}</span> : null}
              </div>
            );
          })}
        </div>
          <div className="cal-body" style={{ gridTemplateColumns: grid, height: 1440 * PX }}>
            <div className="cal-gutter">
              {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
                <div key={h} className="cal-hour" style={{ top: h * 60 * PX }}>
                  {pad(h)}:00
                </div>
              ))}
            </div>
            {columns.map(({ person, blocks: bs, entries: es, running }) => (
              <div key={person.id} className="cal-col" onClick={(e) => clickColumn(person, e)}>
                {Array.from({ length: 48 }, (_, i) => (
                  <div key={i} className={`cal-line ${i % 2 ? "half" : ""}`} style={{ top: i * 30 * PX }} />
                ))}
                {isToday ? <div className="cal-now" style={{ top: nowMin * PX }} /> : null}
                {es.map((x) => {
                  const s = Math.max(dayStart, new Date(x.started_at).getTime());
                  const e = Math.min(dayEnd, new Date(x.ended_at).getTime());
                  return <div key={x.id} className={`cal-actual ${x.mode === "break" ? "brk" : ""}`} style={{ top: ((s - dayStart) / 60_000) * PX, height: Math.max(2, ((e - s) / 60_000) * PX) }} title={`${x.label ?? "Tracked"} ${fmtTime(x.started_at)}–${fmtTime(x.ended_at)}`} />;
                })}
                {running?.status === "running" && running.segment_started_at && isToday ? (
                  <div
                    className="cal-actual running"
                    style={{
                      top: ((Math.max(dayStart, new Date(running.segment_started_at).getTime()) - dayStart) / 60_000) * PX,
                      height: Math.max(2, ((now - Math.max(dayStart, new Date(running.segment_started_at).getTime())) / 60_000) * PX)
                    }}
                  />
                ) : null}
                {bs.map((b) => {
                  const s = Math.max(dayStart, new Date(b.starts_at).getTime());
                  const e = Math.min(dayEnd, new Date(b.ends_at).getTime());
                  const h = ((e - s) / 60_000) * PX;
                  const mineStatus = b.participants.find((x) => x.user_id === person.id)?.status;
                  const together = b.participants.filter((x) => x.status !== "declined");
                  return (
                    <div
                      key={b.id}
                      className={`cal-block ${mineStatus === "invited" ? "invited" : ""}`}
                      style={{ top: ((s - dayStart) / 60_000) * PX, height: Math.max(18, h - 2), ["--c" as string]: b.project_color ?? person.color }}
                      onClick={() => setOpen(b)}
                      title={`${b.title} · ${fmtTime(b.starts_at)}–${fmtTime(b.ends_at)}`}
                    >
                      <div className="t ellipsis">
                        {mineStatus === "invited" ? "✉ " : ""}
                        {b.title}
                      </div>
                      {h >= 34 ? (
                        <div className="tiny muted ellipsis num">
                          {fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}
                          {together.length > 1 ? ` · 👥 ${together.map((x) => (x.user_id === me.user.id ? "you" : x.name)).join(" + ")}` : ""}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {draft ? <BlockEditor draft={draft} projects={catalog.projects} tasks={catalog.tasks} onClose={() => setDraft(null)} onSaved={reloadAll} /> : null}
      {open ? <BlockEditor block={open} projects={catalog.projects} tasks={catalog.tasks} onClose={() => setOpen(null)} onSaved={reloadAll} /> : null}
    </main>
  );
}
