import { subDays } from "date-fns";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api/auth";
import { badRequest, serverError, unauthorized } from "@/lib/api/http";
import { InsightRange, getRangeWindow } from "@/lib/date-range";
import { buildHourBuckets, buildTaskBreakdown, buildTrend, getMostProductiveHour } from "@/lib/insights";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const validRange = (value: string): value is InsightRange => ["day", "week", "month", "year"].includes(value);

export async function GET(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const range = url.searchParams.get("range") ?? "day";
  const anchor = url.searchParams.get("anchor") ?? new Date().toISOString().slice(0, 10);

  if (!validRange(range)) return badRequest("Invalid range");

  const { start, end } = getRangeWindow(range, `${anchor}T00:00:00.000Z`);

  const supabase = createSupabaseAdminClient();
  const [sessionsRes, tasksRes] = await Promise.all([
    supabase
      .from("sessions")
      .select("*")
      .eq("user_id", user.id)
      .gte("started_at", start.toISOString())
      .lte("started_at", end.toISOString()),
    supabase
      .from("tasks")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
  ]);

  if (sessionsRes.error) return serverError(sessionsRes.error.message);
  if (tasksRes.error) return serverError(tasksRes.error.message);

  const sessions = sessionsRes.data ?? [];
  const tasks = tasksRes.data ?? [];

  const hourBuckets = buildHourBuckets(sessions);
  const productiveHour = getMostProductiveHour(hourBuckets);
  const trend = buildTrend(sessions, range === "day" ? 1 : range === "week" ? 7 : range === "month" ? 30 : 365);
  const breakdown = buildTaskBreakdown(tasks);
  const focusTotalSeconds = sessions
    .filter((session) => session.mode === "focus")
    .reduce((sum, session) => sum + session.actual_duration_sec, 0);

  const previousStart = subDays(start, Math.ceil((end.getTime() - start.getTime()) / (24 * 3600 * 1000)) + 1);
  const previousEnd = subDays(start, 1);

  const previousRes = await supabase
    .from("sessions")
    .select("actual_duration_sec, mode")
    .eq("user_id", user.id)
    .eq("mode", "focus")
    .gte("started_at", previousStart.toISOString())
    .lte("started_at", previousEnd.toISOString());

  if (previousRes.error) return serverError(previousRes.error.message);

  const previousFocus = (previousRes.data ?? []).reduce((sum, row) => sum + row.actual_duration_sec, 0);
  const periodDeltaPct = previousFocus === 0 ? 100 : ((focusTotalSeconds - previousFocus) / previousFocus) * 100;

  return NextResponse.json({
    range,
    breakdown,
    productiveHour,
    hourBuckets,
    trend,
    focusTotalSeconds,
    periodDeltaPct
  });
}
