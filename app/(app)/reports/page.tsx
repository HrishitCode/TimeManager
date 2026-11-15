"use client";

import { useState } from "react";
import { usePeople } from "@/components/MeContext";
import { Avatar, Spinner } from "@/components/ui";
import { useApi } from "@/lib/client/api";
import { ON_TIME_GRACE_MIN, SKIP_THRESHOLD_PCT } from "@/lib/shared/report";
import { addDays, fmtDuration, fmtTime, localDate, weekStart } from "@/lib/shared/time";
import type { MemberReport, WorkspaceReport } from "@/lib/shared/types";

const clock = (min: number | null) => (min === null ? "—" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`);
const pctTxt = (v: number) => `${Math.round(v)}%`;

interface Row {
  label: string;
  hint?: string;
  value: (m: MemberReport) => number | null;
  fmt: (v: number | null, m: MemberReport) => string;
  better?: "high" | "low";
}

const ROWS: Row[] = [
  { label: "Score", hint: "50% adherence · 20% punctuality · 30% tasks", value: (m) => m.score, fmt: (v) => `${v}`, better: "high" },
  { label: "Focused", value: (m) => m.focus_min, fmt: (v) => fmtDuration(v ?? 0), better: "high" },
  { label: "Planned (so far)", value: (m) => m.planned_min, fmt: (v, m) => `${fmtDuration(v ?? 0)}${m.upcoming_min > 0 ? ` +${fmtDuration(m.upcoming_min)} ahead` : ""}` },
  { label: "Focused on plan", value: (m) => m.on_plan_min, fmt: (v) => fmtDuration(v ?? 0), better: "high" },
  { label: "Plan adherence", hint: "on-plan focus ÷ planned time", value: (m) => (m.planned_min > 0 ? m.adherence_pct : null), fmt: (v) => (v === null ? "—" : pctTxt(v)), better: "high" },
  { label: "Unplanned focus", value: (m) => m.off_plan_min, fmt: (v) => fmtDuration(v ?? 0) },
  { label: "Blocks started", value: (m) => (m.blocks_planned ? (m.blocks_started / m.blocks_planned) * 100 : null), fmt: (_v, m) => (m.blocks_planned ? `${m.blocks_started} / ${m.blocks_planned}` : "—"), better: "high" },
  { label: "Blocks skipped", hint: `finished with <${SKIP_THRESHOLD_PCT}% attended`, value: (m) => m.blocks_skipped, fmt: (v) => `${v}`, better: "low" },
  { label: "On-time starts", hint: `focus within ${ON_TIME_GRACE_MIN} min of block start`, value: (m) => (m.blocks_planned ? m.on_time_pct : null), fmt: (v) => (v === null ? "—" : pctTxt(v)), better: "high" },
  { label: "Avg. lateness", value: (m) => m.avg_late_min, fmt: (v) => (v === null ? "—" : `${Math.round(v)}m`), better: "low" },
  { label: "Tasks done", value: (m) => m.tasks_done, fmt: (v, m) => `${v}${m.tasks_due ? ` / ${m.tasks_due} due` : ""}`, better: "high" },
  { label: "Avg. day start", value: (m) => m.avg_start_min, fmt: (v) => clock(v), better: "low" },
  { label: "Best hour", value: (m) => m.best_hour, fmt: (v) => (v === null ? "—" : `${String(v).padStart(2, "0")}:00`) }
];

export default function ReportsPage() {
  const people = usePeople();
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [date, setDate] = useState(() => localDate());
  const { data, error } = useApi<WorkspaceReport>(`/api/reports?period=${period}&date=${date}`, { refreshMs: 120_000 });

  const step = (n: number) => setDate(addDays(period === "week" ? weekStart(date) : date, n * (period === "week" ? 7 : 1)));
  const title =
    period === "day"
      ? new Date(`${date}T00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })
      : `Week of ${new Date(`${weekStart(date)}T00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}`;
  const colorOf = (id: string) => people.find((p) => p.id === id)?.color ?? "var(--muted)";
  const nameOf = (m: { user_id: string; name: string }) => (people.find((p) => p.id === m.user_id)?.isMe ? "You" : m.name);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="muted small">{people.length > 1 ? "How each of you managed your time" : "How you managed your time"}</p>
        </div>
        <div className="row wrap">
          <div className="seg">
            <button className={period === "day" ? "on" : ""} onClick={() => setPeriod("day")}>
              Daily
            </button>
            <button className={period === "week" ? "on" : ""} onClick={() => setPeriod("week")}>
              Weekly
            </button>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="icon" onClick={() => step(-1)} aria-label="Previous">
              ←
            </button>
            <button className="sm" onClick={() => setDate(localDate())}>
              {period === "day" ? "Today" : "This week"}
            </button>
            <button className="icon" onClick={() => step(1)} aria-label="Next">
              →
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="callout bad">{error}</div> : null}
      {!data ? (
        <Spinner />
      ) : (
        <div className="stack-lg">
          {data.members.length > 1 ? (
            <section className="card">
              <div className="card-head">
                <h2>Who managed time better</h2>
              </div>
              {data.verdicts.length ? (
                data.verdicts.map((v) => {
                  const winner = data.members.find((m) => m.user_id === v.winner_id);
                  return (
                    <div key={v.metric} className="verdict">
                      {winner ? <Avatar name={winner.name} color={colorOf(winner.user_id)} small /> : <span className="chip">=</span>}
                      <div className="grow">
                        <div className="tiny muted strong">{v.metric}</div>
                        <div>{personalize(v.text, data.members.find((m) => people.find((p) => p.id === m.user_id)?.isMe)?.name)}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="muted small">Not enough tracked or planned time yet to compare.</p>
              )}
            </section>
          ) : (
            <div className="callout">Invite a partner from the <a className="link" href="/together">Together</a> page to get side-by-side comparisons.</div>
          )}

          <div className="grid-auto">
            {data.members.map((m) => (
              <section key={m.user_id} className="card">
                <div className="row between" style={{ marginBottom: 14 }}>
                  <div className="person">
                    <Avatar name={m.name} color={colorOf(m.user_id)} />
                    <div>
                      <div className="strong">{nameOf(m)}</div>
                      <div className="tiny muted">score</div>
                    </div>
                  </div>
                  <div className="score" style={{ color: colorOf(m.user_id) }}>{m.score}</div>
                </div>
                <div className="stat-grid">
                  <Stat k="focused" v={fmtDuration(m.focus_min)} />
                  <Stat k="plan adherence" v={m.planned_min ? pctTxt(m.adherence_pct) : "—"} />
                  <Stat k="on-time starts" v={m.blocks_planned ? pctTxt(m.on_time_pct) : "—"} />
                  <Stat k="tasks done" v={`${m.tasks_done}${m.tasks_due ? `/${m.tasks_due}` : ""}`} />
                </div>
                {m.planned_min > 0 ? (
                  <div style={{ marginTop: 14 }}>
                    <div className="row between tiny muted">
                      <span>on plan {fmtDuration(m.on_plan_min)}</span>
                      <span>planned {fmtDuration(m.planned_min)}</span>
                    </div>
                    <div className="meter" style={{ marginTop: 4 }}>
                      <div style={{ width: `${m.adherence_pct}%`, background: colorOf(m.user_id) }} />
                    </div>
                  </div>
                ) : null}
                {m.projects.length ? (
                  <div style={{ marginTop: 16 }}>
                    <div className="group-title">Where the time went</div>
                    {m.projects.map((p) => (
                      <div key={p.project_id ?? "none"} className="hbar">
                        <span className="ellipsis small">{p.name}</span>
                        <div className="meter">
                          <div style={{ width: `${(p.focus_min / Math.max(1, m.focus_min)) * 100}%`, background: p.color }} />
                        </div>
                        <span className="small num muted" style={{ textAlign: "right" }}>{fmtDuration(p.focus_min)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </div>

          {period === "week" ? <WeekChart data={data} colorOf={colorOf} nameOf={nameOf} /> : null}

          <section className="card">
            <div className="card-head">
              <h2>Side by side</h2>
            </div>
            <div className="table-wrap">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th />
                    {data.members.map((m) => (
                      <th key={m.user_id}>
                        <span className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                          <span className="dot" style={{ background: colorOf(m.user_id) }} />
                          {nameOf(m)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => {
                    const vals = data.members.map((m) => r.value(m));
                    const nums = vals.filter((v): v is number => v !== null);
                    const best = r.better && data.members.length > 1 && nums.length > 1 && new Set(nums).size > 1 ? (r.better === "high" ? Math.max(...nums) : Math.min(...nums)) : null;
                    return (
                      <tr key={r.label}>
                        <td>
                          {r.label}
                          {r.hint ? <div className="tiny muted">{r.hint}</div> : null}
                        </td>
                        {data.members.map((m, i) => (
                          <td key={m.user_id} className={best !== null && vals[i] === best ? "win" : ""}>
                            {r.fmt(vals[i], m)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {data.joint_sessions.length ? (
            <section className="card">
              <div className="card-head">
                <h2>Sessions together</h2>
                <span className="muted small">who actually showed up</span>
              </div>
              {data.joint_sessions.map((j) => (
                <div key={j.block_id} className="agenda-item">
                  <div className="agenda-time">
                    {period === "week" ? `${new Date(j.starts_at).toLocaleDateString([], { weekday: "short" })} ` : ""}
                    {fmtTime(j.starts_at)}–{fmtTime(j.ends_at)}
                  </div>
                  <div className="grow">
                    <div className="strong">{j.title}</div>
                    <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                      {j.members.map((m) => (
                        <div key={m.user_id} className="hbar" style={{ gridTemplateColumns: "70px 1fr 110px" }}>
                          <span className="small">{nameOf(m)}</span>
                          <div className="meter">
                            <div style={{ width: `${m.attended_pct}%`, background: colorOf(m.user_id) }} />
                          </div>
                          <span className="tiny muted num" style={{ textAlign: "right" }}>
                            {fmtDuration(m.attended_min)}
                            {m.late_min === null ? " · no-show" : m.late_min > ON_TIME_GRACE_MIN ? ` · ${Math.round(m.late_min)}m late` : " · on time"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {period === "day" ? (
            <div className="grid-auto">
              {data.members.map((m) => (
                <section key={m.user_id} className="card">
                  <div className="card-head">
                    <h3>{nameOf(m)} · block by block</h3>
                  </div>
                  {m.blocks.length ? (
                    m.blocks.map((b) => (
                      <div key={b.block_id} className="agenda-item">
                        <div className="agenda-time">
                          {fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}
                        </div>
                        <div className="grow ellipsis">
                          {b.shared ? "👥 " : ""}
                          {b.title}
                        </div>
                        <span className={`chip ${b.attended_pct >= 80 ? "good" : b.attended_pct >= SKIP_THRESHOLD_PCT ? "warn" : "bad"}`}>{Math.round(b.attended_pct)}%</span>
                      </div>
                    ))
                  ) : (
                    <p className="muted small">No blocks had started.</p>
                  )}
                </section>
              ))}
            </div>
          ) : null}

          <p className="tiny muted">
            Everything here is computed from two things only: the blocks you planned and the time you tracked. It works on trust — log honestly, including breaks and forgotten timers.
          </p>
        </div>
      )}
    </main>
  );
}

/** Server verdicts use names; show the viewer as "You"/"you". */
const personalize = (text: string, myName?: string) => {
  if (!myName) return text;
  const n = myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^${n}\\b`), "You").replace(new RegExp(`(vs |, |\\()${n}\\b`, "g"), "$1you");
};

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

function WeekChart({ data, colorOf, nameOf }: { data: WorkspaceReport; colorOf: (id: string) => string; nameOf: (m: MemberReport) => string }) {
  const max = Math.max(60, ...data.members.flatMap((m) => m.series.flatMap((s) => [s.focus_min, s.planned_min])));
  const dates = data.members[0]?.series.map((s) => s.date) ?? [];
  return (
    <section className="card">
      <div className="card-head">
        <h2>Day by day</h2>
        <div className="cal-legend" style={{ marginTop: 0 }}>
          {data.members.map((m) => (
            <span key={m.user_id}>
              <i className="swatch" style={{ background: colorOf(m.user_id) }} /> {nameOf(m)} focus
            </span>
          ))}
          <span>
            <i className="swatch" style={{ border: "1.5px dashed var(--line-strong)" }} /> planned
          </span>
        </div>
      </div>
      <div className="bars">
        {dates.map((d, i) => (
          <div key={d} className="bars-day">
            <div className="bars-stack">
              {data.members.map((m) => {
                const s = m.series[i];
                return (
                  <div key={m.user_id} style={{ position: "relative", flex: 1, maxWidth: 16, height: "100%", display: "flex", alignItems: "flex-end" }} title={`${nameOf(m)}: ${fmtDuration(s.focus_min)} focused / ${fmtDuration(s.planned_min)} planned`}>
                    <div className="bar" style={{ height: `${(s.focus_min / max) * 100}%`, background: colorOf(m.user_id), maxWidth: "none" }} />
                    {s.planned_min > 0 ? <div className="bar-plan" style={{ height: `${(s.planned_min / max) * 100}%` }} /> : null}
                  </div>
                );
              })}
            </div>
            <div className="bars-label">{new Date(`${d}T00:00`).toLocaleDateString([], { weekday: "short" })}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
