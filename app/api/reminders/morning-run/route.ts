import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { addDaysToDateString, computeDailyReport, DEFAULT_REPORT_TIMEZONE, dayWindowForIstDate, todayIstDate } from "@/lib/reporting";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { Project, Session, Task, TimeBooking } from "@/types/domain";

const toTime24 = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

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
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const reminderFrom = process.env.REMINDER_FROM_EMAIL;
  const reminderTo = process.env.REMINDER_TO_EMAIL;
  if (!resendKey || !reminderFrom || !reminderTo) {
    return NextResponse.json(
      { error: "Missing reminder env vars (RESEND_API_KEY, REMINDER_FROM_EMAIL, REMINDER_TO_EMAIL)." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const today = todayIstDate();
  const yesterday = addDaysToDateString(today, -1);

  const usersRes = await supabase.from("projects").select("user_id");
  if (usersRes.error) {
    return NextResponse.json({ error: usersRes.error.message }, { status: 500 });
  }

  const uniqueUserIds = Array.from(new Set((usersRes.data ?? []).map((row) => row.user_id)));
  if (uniqueUserIds.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0 });
  }

  let sent = 0;
  for (const userId of uniqueUserIds) {
    const existingLog = await supabase
      .from("daily_digest_logs")
      .select("id")
      .eq("user_id", userId)
      .eq("digest_date", today)
      .maybeSingle();

    if (existingLog.error) {
      return NextResponse.json({ error: existingLog.error.message }, { status: 500 });
    }
    if (existingLog.data) {
      continue;
    }

    const [projectsRes, tasksRes, todayData, yesterdayData] = await Promise.all([
      supabase.from("projects").select("id, name").eq("user_id", userId),
      supabase.from("tasks").select("id, title").eq("user_id", userId),
      loadBookingsAndSessionsForDate(userId, today),
      loadBookingsAndSessionsForDate(userId, yesterday)
    ]);

    if (projectsRes.error) return NextResponse.json({ error: projectsRes.error.message }, { status: 500 });
    if (tasksRes.error) return NextResponse.json({ error: tasksRes.error.message }, { status: 500 });

    const projects = (projectsRes.data ?? []) as Pick<Project, "id" | "name">[];
    const tasks = (tasksRes.data ?? []) as Pick<Task, "id" | "title">[];

    const todayReport = computeDailyReport({
      date: today,
      timezone: DEFAULT_REPORT_TIMEZONE,
      bookings: todayData.bookings,
      sessions: todayData.sessions,
      projects,
      tasks
    });
    const yesterdayReport = computeDailyReport({
      date: yesterday,
      timezone: DEFAULT_REPORT_TIMEZONE,
      bookings: yesterdayData.bookings,
      sessions: yesterdayData.sessions,
      projects,
      tasks
    });

    const trailingDates = Array.from({ length: 7 }, (_, idx) => addDaysToDateString(today, -(idx + 1)));
    const trailingData = await Promise.all(trailingDates.map((date) => loadBookingsAndSessionsForDate(userId, date)));
    const trailingUtilization = trailingData.map((item, idx) =>
      computeDailyReport({
        date: trailingDates[idx],
        timezone: DEFAULT_REPORT_TIMEZONE,
        bookings: item.bookings,
        sessions: item.sessions,
        projects,
        tasks
      }).summary.utilization_pct
    );
    const trailingAvg =
      trailingUtilization.length > 0
        ? trailingUtilization.reduce((sum, value) => sum + value, 0) / trailingUtilization.length
        : 0;

    const scheduleLines =
      todayReport.slots.length > 0
        ? todayReport.slots.map(
            (slot) =>
              `- ${toTime24(slot.starts_at)}-${toTime24(slot.ends_at)} | ${slot.project_name}${
                slot.task_name !== "No task" ? ` · ${slot.task_name}` : ""
              }`
          )
        : ["- No slots booked for today"];

    const text = [
      `Good morning!`,
      ``,
      `Today's plan (${today}):`,
      ...scheduleLines,
      ``,
      `Yesterday summary (${yesterday}):`,
      `Booked: ${yesterdayReport.summary.booked_minutes.toFixed(1)} min`,
      `Performed: ${yesterdayReport.summary.performed_minutes.toFixed(1)} min`,
      `Wasted: ${yesterdayReport.summary.wasted_minutes.toFixed(1)} min`,
      `Utilization: ${yesterdayReport.summary.utilization_pct.toFixed(1)}%`,
      ``,
      `Today vs 7-day average utilization: ${(todayReport.summary.utilization_pct - trailingAvg).toFixed(1)}%`,
      `7-day average utilization: ${trailingAvg.toFixed(1)}%`
    ].join("\n");

    const sendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: reminderFrom,
        to: [reminderTo],
        subject: `Morning schedule and summary · ${today}`,
        text
      })
    });

    if (!sendResponse.ok) {
      continue;
    }

    const logRes = await supabase.from("daily_digest_logs").insert({
      user_id: userId,
      digest_date: today
    });
    if (!logRes.error) {
      sent += 1;
    }
  }

  return NextResponse.json({ processed: uniqueUserIds.length, sent });
}
