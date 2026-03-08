import { addMinutes } from "date-fns";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type ReminderType = "pre_start_10m" | "late_1m";

const isInWindow = (value: number, min: number, max: number) => value >= min && value <= max;

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
  const now = new Date();
  const from = addMinutes(now, -3).toISOString();
  const to = addMinutes(now, 11).toISOString();

  const bookingsRes = await supabase
    .from("time_bookings")
    .select("*")
    .gte("starts_at", from)
    .lte("starts_at", to);

  if (bookingsRes.error) {
    return NextResponse.json({ error: bookingsRes.error.message }, { status: 500 });
  }

  const bookings = bookingsRes.data ?? [];
  if (!bookings.length) {
    return NextResponse.json({ processed: 0, sent: 0 });
  }

  const bookingIds = bookings.map((booking) => booking.id);
  const logsRes = await supabase
    .from("time_booking_reminders")
    .select("booking_id, reminder_type")
    .in("booking_id", bookingIds);

  if (logsRes.error) {
    return NextResponse.json({ error: logsRes.error.message }, { status: 500 });
  }

  const sentMap = new Set((logsRes.data ?? []).map((row) => `${row.booking_id}:${row.reminder_type}`));
  const sendEmail = async (subject: string, text: string) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: reminderFrom,
        to: [reminderTo],
        subject,
        text
      })
    });
    return response.ok;
  };

  const getActiveSessionForUser = async (userId: string) => {
    const stateRes = await supabase
      .from("timer_states")
      .select("active_session_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (stateRes.error || !stateRes.data?.active_session_id) return null;

    const sessionRes = await supabase
      .from("sessions")
      .select("id, project_id, task_id, status")
      .eq("id", stateRes.data.active_session_id)
      .maybeSingle();

    if (sessionRes.error || !sessionRes.data) return null;
    return sessionRes.data;
  };

  let sent = 0;
  for (const booking of bookings) {
    const bookingStart = new Date(booking.starts_at);
    const minutesToStart = (bookingStart.getTime() - now.getTime()) / 60_000;

    let reminderType: ReminderType | null = null;
    if (isInWindow(minutesToStart, 9, 10.99)) {
      reminderType = "pre_start_10m";
    } else if (isInWindow(minutesToStart, -1.99, -1)) {
      reminderType = "late_1m";
    }

    if (!reminderType) continue;
    if (sentMap.has(`${booking.id}:${reminderType}`)) continue;

    if (reminderType === "late_1m") {
      const active = await getActiveSessionForUser(booking.user_id);
      const timerMatches =
        active &&
        active.status === "running" &&
        active.project_id === booking.project_id &&
        (booking.task_id ? active.task_id === booking.task_id : true);

      if (timerMatches) {
        continue;
      }
    }

    const subject =
      reminderType === "pre_start_10m"
        ? "Pomodoro reminder: booking starts in 10 minutes"
        : "Pomodoro reminder: booking started 1 minute ago (timer still off)";

    const text = [
      `Project ID: ${booking.project_id}`,
      `Task ID: ${booking.task_id ?? "(none)"}`,
      `Start: ${new Date(booking.starts_at).toLocaleString()}`,
      `End: ${new Date(booking.ends_at).toLocaleString()}`
    ].join("\n");

    const sentOk = await sendEmail(subject, text);
    if (!sentOk) {
      continue;
    }

    const logRes = await supabase.from("time_booking_reminders").insert({
      booking_id: booking.id,
      reminder_type: reminderType
    });

    if (!logRes.error) {
      sent += 1;
      sentMap.add(`${booking.id}:${reminderType}`);
    }
  }

  return NextResponse.json({ processed: bookings.length, sent });
}
