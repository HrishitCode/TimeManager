import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api/auth";
import { badRequest, serverError, unauthorized } from "@/lib/api/http";
import { addDaysToDateString, computeDailyReport, dayWindowForIstDate, DEFAULT_REPORT_TIMEZONE, todayIstDate } from "@/lib/reporting";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { DailyReportsResponse, Project, Session, Task, TimeBooking } from "@/types/domain";

const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const loadBookingsAndSessionsForDate = async (userId: string, date: string) => {
  const supabase = createSupabaseAdminClient();
  const { start, end } = dayWindowForIstDate(date);

  const [bookingsRes, sessionsRes] = await Promise.all([
    supabase
      .from("time_bookings")
      .select("*")
      .eq("user_id", userId)
      .lt("starts_at", end.toISOString())
      .gt("ends_at", start.toISOString())
      .order("starts_at", { ascending: true }),
    supabase
      .from("sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("mode", "focus")
      .lt("started_at", end.toISOString())
      .order("started_at", { ascending: true })
  ]);

  if (bookingsRes.error) throw new Error(bookingsRes.error.message);
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);

  return {
    bookings: (bookingsRes.data ?? []) as TimeBooking[],
    sessions: (sessionsRes.data ?? []) as Session[]
  };
};

export async function GET(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? todayIstDate();
  const timezone = DEFAULT_REPORT_TIMEZONE;

  if (!isValidDate(date)) {
    return badRequest("Invalid date format. Use YYYY-MM-DD.");
  }

  const supabase = createSupabaseAdminClient();

  try {
    const [projectsRes, tasksRes, todayData, yesterdayData] = await Promise.all([
      supabase.from("projects").select("id, name").eq("user_id", user.id),
      supabase.from("tasks").select("id, title").eq("user_id", user.id),
      loadBookingsAndSessionsForDate(user.id, date),
      loadBookingsAndSessionsForDate(user.id, addDaysToDateString(date, -1))
    ]);

    if (projectsRes.error) return serverError(projectsRes.error.message);
    if (tasksRes.error) return serverError(tasksRes.error.message);

    const projects = (projectsRes.data ?? []) as Pick<Project, "id" | "name">[];
    const tasks = (tasksRes.data ?? []) as Pick<Task, "id" | "title">[];

    const todayReport = computeDailyReport({
      date,
      timezone,
      bookings: todayData.bookings,
      sessions: todayData.sessions,
      projects,
      tasks
    });

    const yesterdayDate = addDaysToDateString(date, -1);
    const yesterdayReport = computeDailyReport({
      date: yesterdayDate,
      timezone,
      bookings: yesterdayData.bookings,
      sessions: yesterdayData.sessions,
      projects,
      tasks
    });

    const trailingDates = Array.from({ length: 7 }, (_, idx) => addDaysToDateString(date, -(idx + 1)));
    const trailingReportsData = await Promise.all(
      trailingDates.map((trailingDate) => loadBookingsAndSessionsForDate(user.id, trailingDate))
    );
    const trailingUtilizations = trailingReportsData
      .map((data, idx) =>
        computeDailyReport({
          date: trailingDates[idx],
          timezone,
          bookings: data.bookings,
          sessions: data.sessions,
          projects,
          tasks
        }).summary.utilization_pct
      )
      .filter((value) => Number.isFinite(value));
    const trailingAverage = trailingUtilizations.length
      ? trailingUtilizations.reduce((sum, value) => sum + value, 0) / trailingUtilizations.length
      : 0;

    const response: DailyReportsResponse = {
      ...todayReport,
      comparison: {
        yesterday: {
          date: yesterdayDate,
          utilization_pct: Number(yesterdayReport.summary.utilization_pct.toFixed(2)),
          delta_pct: Number((todayReport.summary.utilization_pct - yesterdayReport.summary.utilization_pct).toFixed(2))
        },
        trailing_average_7d: {
          utilization_pct: Number(trailingAverage.toFixed(2)),
          delta_pct: Number((todayReport.summary.utilization_pct - trailingAverage).toFixed(2))
        }
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    return serverError(error instanceof Error ? error.message : "Could not build daily report");
  }
}
