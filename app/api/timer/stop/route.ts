import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { badRequest, conflict, serverError, unauthorized } from "@/lib/api/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { calculateActualDurationSec } from "@/lib/timer";

const schema = z.object({
  stateVersion: z.number().int().min(0),
  deviceId: z.string().min(1),
  acceptOvertime: z.boolean().optional().default(false)
});

export async function POST(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const supabase = createSupabaseAdminClient();
  const timerStateResult = await supabase.from("timer_states").select("*").eq("user_id", user.id).single();
  if (timerStateResult.error) return serverError(timerStateResult.error.message);

  const timerState = timerStateResult.data;
  if (timerState.state_version !== parsed.data.stateVersion) {
    return conflict("Timer state mismatch");
  }
  if (!timerState.active_session_id) {
    return badRequest("No active session");
  }

  const sessionResult = await supabase.from("sessions").select("*").eq("id", timerState.active_session_id).single();
  if (sessionResult.error) return serverError(sessionResult.error.message);

  const now = new Date().toISOString();
  const actualDurationSec = calculateActualDurationSec(sessionResult.data.started_at, now, sessionResult.data.actual_duration_sec);
  const overtimeSec = Math.max(0, actualDurationSec - sessionResult.data.planned_duration_sec);
  const acceptedOvertime = parsed.data.acceptOvertime && overtimeSec > 0;
  const persistedActual = acceptedOvertime
    ? actualDurationSec
    : Math.min(actualDurationSec, sessionResult.data.planned_duration_sec);

  const updatedSession = await supabase
    .from("sessions")
    .update({
      status: "stopped",
      ended_at: now,
      actual_duration_sec: persistedActual,
      overtime_sec: acceptedOvertime ? overtimeSec : 0,
      accepted_overtime: acceptedOvertime
    })
    .eq("id", timerState.active_session_id)
    .select("*")
    .single();

  if (updatedSession.error) {
    if (updatedSession.error.code === "42703") {
      return NextResponse.json(
        {
          error:
            "Overtime columns are missing. Run supabase/migrations/0002_overtime.sql in your Supabase SQL editor."
        },
        { status: 503 }
      );
    }
    return serverError(updatedSession.error.message);
  }

  const updatedTimer = await supabase
    .from("timer_states")
    .update({
      active_session_id: null,
      state_version: timerState.state_version + 1,
      updated_by_device_id: parsed.data.deviceId
    })
    .eq("user_id", user.id)
    .eq("state_version", timerState.state_version)
    .select("*")
    .single();

  if (updatedTimer.error) return conflict("Concurrent timer update detected");

  return NextResponse.json({ timerState: updatedTimer.data, activeSession: updatedSession.data });
}
