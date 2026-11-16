"use client";

import { useState } from "react";
import { usePeople } from "@/components/MeContext";
import { Avatar, Spinner } from "@/components/ui";
import { useApi } from "@/lib/client/api";
import { personalize } from "@/lib/shared/personalize";
import { ON_TIME_GRACE_MIN, PLAN_COVERAGE_TARGET, SKIP_THRESHOLD_PCT } from "@/lib/shared/report";
import { addDays, fmtDuration, fmtTime, localDate, weekStart } from "@/lib/shared/time";
import type { MemberReport, Verdict, WorkspaceReport } from "@/lib/shared/types";

const clock = (min: number | null) => (min === null ? "—" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`);
const pctTxt = (v: number) => `${Math.round(v)}%`;

interface Row {
  label: string;
  hint?: string;
  value: (m: MemberReport) => number | null;
  fmt: (v: number | null, m: MemberReport) => string;
  better?: "high" | "low";
  /** Same "too close to call" thresholds as the server's verdicts, so the table and verdicts agree. */
  minGap?: number;
}

const dash = (v: number | null, f: (n: number) => string) => (v === null ? "—" : f(v));

/** The comparison answers three questions, in this order. */
const SECTIONS: { key: Verdict["section"]; title: string; blurb: string; rows: Row[] }[] = [
  {
    key: "time",
    title: "1 · Time available",
    blurb: "Your day window minus anything you left out (office etc.)",
    rows: [
      { label: "Countable time", hint: "day window − left-out time, so far", value: (m) => m.countable_min, fmt: (v) => fmtDuration(v ?? 0) },
      { label: "Left out", value: (m) => m.excluded_min, fmt: (v) => (v ? fmtDuration(v) : "—") }
    ]
  },
  {
    key: "work",
    title: "2 · Work done",
    blurb: "How much each of you actually focused",
    rows: [
      { label: "Focused", value: (m) => m.focus_min, fmt: (v) => fmtDuration(v ?? 0), better: "high", minGap: 10 },
      { label: "Share of countable time", hint: "focused ÷ countable", value: (m) => (m.countable_min ? m.focus_share_pct : null), fmt: (v) => dash(v, pctTxt), better: "high", minGap: 3 },
      { label: "Unplanned focus", hint: "work outside planned blocks", value: (m) => m.off_plan_min, fmt: (v) => fmtDuration(v ?? 0) },
      { label: "Best hour", value: (m) => m.best_hour, fmt: (v) => dash(v, (n) => `${String(n).padStart(2, "0")}:00`) }
    ]
  },
  {
    key: "discipline",
    title: "3 · Discipline",
    blurb: "Did you make a plan, and keep it?",
    rows: [
      {
        label: "Discipline",
        hint: `45 fulfilled · 20 planned ≥${Math.round(PLAN_COVERAGE_TARGET * 100)}% of countable · 15 on time · 20 tasks`,
        value: (m) => m.discipline_score,
        fmt: (v) => dash(v, (n) => `${n}/100`),
        better: "high",
        minGap: 3
      },
      {
        label: "Time planned",
        hint: "share of countable time",
        value: (m) => (m.countable_min ? m.planned_share_pct : null),
        fmt: (_v, m) => `${fmtDuration(m.planned_min)}${m.countable_min ? ` · ${pctTxt(m.planned_share_pct)}` : ""}${m.upcoming_min > 0 ? ` (+${fmtDuration(m.upcoming_min)} ahead)` : ""}`,
        better: "high"
      },
      { label: "Plan fulfilled", hint: "on-plan focus ÷ planned", value: (m) => (m.planned_min > 0 ? m.adherence_pct : null), fmt: (v) => dash(v, pctTxt), better: "high" },
      { label: "Blocks started", value: (m) => (m.blocks_planned ? (m.blocks_started / m.blocks_planned) * 100 : null), fmt: (_v, m) => (m.blocks_planned ? `${m.blocks_started} / ${m.blocks_planned}` : "—"), better: "high" },
      { label: "Blocks skipped", hint: `finished with <${SKIP_THRESHOLD_PCT}% attended`, value: (m) => (m.blocks_planned ? m.blocks_skipped : null), fmt: (v) => dash(v, String), better: "low" },
      { label: "On-time starts", hint: `focus within ${ON_TIME_GRACE_MIN} min of block start`, value: (m) => (m.blocks_planned ? m.on_time_pct : null), fmt: (v) => dash(v, pctTxt), better: "high" },
      { label: "Avg. lateness", value: (m) => m.avg_late_min, fmt: (v) => dash(v, (n) => `${Math.round(n)}m`), better: "low" },
      { label: "Tasks done", value: (m) => m.tasks_done, fmt: (v, m) => `${v}${m.tasks_due ? ` / ${m.tasks_due} due` : ""}`, better: "high" },
      { label: "Avg. day start", value: (m) => m.avg_start_min, fmt: (v) => clock(v), better: "low" }
    ]
  }
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
  const myName = data?.members.find((m) => people.find((p) => p.id === m.user_id)?.isMe)?.name;

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
                <h2>How you compare</h2>
              </div>
              {data.headline ? <p className="headline">{personalize(data.headline, myName)}</p> : null}
              {SECTIONS.map((sec) => {
                const vs = data.verdicts.filter((v) => v.section === sec.key);
                if (!vs.length) return null;
                return (
                  <div key={sec.key}>
                    <div className="group-title" style={{ marginTop: 16 }}>{sec.title}</div>
                    {vs.map((v) => {
                      const winner = data.members.find((m) => m.user_id === v.winner_id);
                      return (
                        <div key={v.metric} className="verdict">
                          {winner ? (
                            <Avatar name={winner.name} color={colorOf(winner.user_id)} small />
                          ) : (
                            <span className="chip">{v.section === "time" ? "⏱" : "="}</span>
                          )}
                          <div className="grow">
                            <div className="tiny muted strong">{v.metric}</div>
                            <div>{personalize(v.text, myName)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </section>
          ) : (
            <div className="callout">Invite a partner from the <a className="link" href="/together">Together</a> page to get side-by-side comparisons.</div>
          )}

          <div className="grid-auto">
            {data.members.map((m) => (
              <section key={m.user_id} className="card">
                <div className="person" style={{ marginBottom: 14 }}>
                  <Avatar name={m.name} color={colorOf(m.user_id)} />
                  <div className="strong">{nameOf(m)}</div>
                </div>
                <div className="tiles">
                  <div className="tile">
                    <div className="k">1 · Countable</div>
                    <div className="v">{fmtDuration(m.countable_min)}</div>
                    <div className="s">{m.excluded_min > 0 ? `${fmtDuration(m.excluded_min)} left out` : "nothing left out"}</div>
                  </div>
                  <div className="tile">
                    <div className="k">2 · Worked</div>
                    <div className="v" style={{ color: colorOf(m.user_id) }}>{fmtDuration(m.focus_min)}</div>
                    <div className="s">{m.countable_min ? `${pctTxt(m.focus_share_pct)} of countable` : "—"}</div>
                  </div>
                  <div className="tile">
                    <div className="k">3 · Discipline</div>
                    <div className="v">{m.discipline_score ?? "—"}</div>
                    <div className="s">{m.planned_min ? `planned ${pctTxt(m.planned_share_pct)} · kept ${pctTxt(m.adherence_pct)}` : "nothing planned"}</div>
                  </div>
                </div>
                {m.planned_min > 0 ? (
                  <div style={{ marginTop: 14 }}>
                    <div className="row between tiny muted">
                      <span>kept {fmtDuration(m.on_plan_min)}</span>
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
                {SECTIONS.map((sec) => (
                <tbody key={sec.key}>
                  <tr className="section-row">
                    <td colSpan={data.members.length + 1}>
                      {sec.title} <span className="muted" style={{ fontWeight: 400 }}>· {sec.blurb}</span>
                    </td>
                  </tr>
                  {sec.rows.map((r) => {
                    const vals = data.members.map((m) => r.value(m));
                    const nums = vals.filter((v): v is number => v !== null);
                    const sorted = [...nums].sort((a, b) => (r.better === "high" ? b - a : a - b));
                    const clearLead = sorted.length > 1 && Math.abs(sorted[0] - sorted[1]) > Math.max(r.minGap ?? 0, 0);
                    const best = r.better && data.members.length > 1 && clearLead ? sorted[0] : null;
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
                ))}
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
            Everything here comes from three things: your day window, the blocks you planned, and the time you tracked, minus anything you chose to leave out (e.g. office hours). <strong>Worked</strong> and <strong>Discipline</strong> are kept separate on purpose: you can out-work someone without sticking to a plan, and vice versa. It all works on trust, so log honestly, including breaks and forgotten timers.
          </p>
        </div>
      )}
    </main>
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
