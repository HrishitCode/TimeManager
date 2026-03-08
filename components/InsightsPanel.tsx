"use client";

import { useEffect, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line } from "recharts";
import { apiFetch } from "@/lib/api/client";
import { DailyReportsResponse } from "@/types/domain";

const todayDateInput = () => new Date().toISOString().slice(0, 10);

export default function InsightsPanel({ token }: { token: string }) {
  const [date, setDate] = useState(todayDateInput());
  const [insight, setInsight] = useState<DailyReportsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<DailyReportsResponse>(`/api/reports/daily?date=${date}`, token)
      .then((data) => {
        setInsight(data);
        setError("");
      })
      .catch((err) => {
        setInsight(null);
        setError(err instanceof Error ? err.message : "Could not load report");
      });
  }, [token, date]);

  const hourlyChart = insight
    ? insight.hour_breakdown.map((row) => ({
        hour: `${row.hour.toString().padStart(2, "0")}:00`,
        performed: row.performed_minutes,
        wasted: row.wasted_minutes
      }))
    : [];

  const taskChart = insight
    ? insight.task_breakdown.slice(0, 8).map((row) => ({
        name: row.name,
        utilization: row.performed_pct
      }))
    : [];

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2>Daily Report</h2>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ width: 170 }} />
      </div>

      {!insight ? (
        <p className="muted" style={{ marginTop: 10 }}>
          {error || "Add bookings and timer sessions to generate daily reports."}
        </p>
      ) : (
        <>
          <div className="kpi">
            <div>
              <div className="muted">Booked</div>
              <strong>{insight.summary.booked_minutes.toFixed(1)}m</strong>
            </div>
            <div>
              <div className="muted">Performed</div>
              <strong>{insight.summary.performed_minutes.toFixed(1)}m</strong>
            </div>
            <div>
              <div className="muted">Wasted</div>
              <strong>{insight.summary.wasted_minutes.toFixed(1)}m</strong>
            </div>
            <div>
              <div className="muted">Utilization</div>
              <strong>{insight.summary.utilization_pct.toFixed(1)}%</strong>
            </div>
          </div>

          <div className="kpi">
            <div>
              <div className="muted">Vs Yesterday</div>
              <strong>{insight.comparison.yesterday.delta_pct.toFixed(1)}%</strong>
            </div>
            <div>
              <div className="muted">Yesterday Utilization</div>
              <strong>{insight.comparison.yesterday.utilization_pct.toFixed(1)}%</strong>
            </div>
            <div>
              <div className="muted">Vs 7-day Avg</div>
              <strong>{insight.comparison.trailing_average_7d.delta_pct.toFixed(1)}%</strong>
            </div>
            <div>
              <div className="muted">7-day Avg Utilization</div>
              <strong>{insight.comparison.trailing_average_7d.utilization_pct.toFixed(1)}%</strong>
            </div>
          </div>

          <div style={{ height: 220, marginTop: 14 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyChart}>
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="performed" fill="#2364aa" />
                <Bar dataKey="wasted" fill="#bf4342" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ height: 220, marginTop: 14 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={taskChart}>
                <XAxis dataKey="name" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="utilization" stroke="#bf4342" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid" style={{ marginTop: 14 }}>
            <div className="card">
              <h3>Project Breakdown</h3>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Booked</th>
                    <th>Performed</th>
                    <th>Wasted</th>
                    <th>Utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {insight.project_breakdown.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.booked_minutes.toFixed(1)}</td>
                      <td>{row.performed_minutes.toFixed(1)}</td>
                      <td>{row.wasted_minutes.toFixed(1)}</td>
                      <td>{row.performed_pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3>Task Breakdown</h3>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Booked</th>
                    <th>Performed</th>
                    <th>Wasted</th>
                    <th>Utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {insight.task_breakdown.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.booked_minutes.toFixed(1)}</td>
                      <td>{row.performed_minutes.toFixed(1)}</td>
                      <td>{row.wasted_minutes.toFixed(1)}</td>
                      <td>{row.performed_pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3>Productivity Highlights</h3>
            <p className="muted" style={{ marginTop: 6 }}>
              Minimum 30 booked minutes required for ranking.
            </p>
            <div className="kpi" style={{ marginTop: 12 }}>
              <div>
                <div className="muted">Most Productive Task</div>
                <strong>{insight.most_productive_task?.name ?? "Not enough data"}</strong>
              </div>
              <div>
                <div className="muted">Most Productive Utilization</div>
                <strong>{insight.most_productive_task ? `${insight.most_productive_task.performed_pct.toFixed(1)}%` : "-"}</strong>
              </div>
              <div>
                <div className="muted">Least Productive Task</div>
                <strong>{insight.least_productive_task?.name ?? "Not enough data"}</strong>
              </div>
              <div>
                <div className="muted">Least Productive Utilization</div>
                <strong>{insight.least_productive_task ? `${insight.least_productive_task.performed_pct.toFixed(1)}%` : "-"}</strong>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3>Slot Detail</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Start</th>
                  <th>End</th>
                  <th>Project</th>
                  <th>Task</th>
                  <th>Booked</th>
                  <th>Performed</th>
                  <th>Wasted</th>
                </tr>
              </thead>
              <tbody>
                {insight.slots.map((row) => (
                  <tr key={row.booking_id}>
                    <td>{new Date(row.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</td>
                    <td>{new Date(row.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</td>
                    <td>{row.project_name}</td>
                    <td>{row.task_name}</td>
                    <td>{row.booked_minutes.toFixed(1)}</td>
                    <td>{row.performed_minutes.toFixed(1)}</td>
                    <td>{row.wasted_minutes.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
