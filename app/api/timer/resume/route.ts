import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { badRequest, conflict, serverError, unauthorized } from "@/lib/api/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const schema = z.object({
  stateVersion: z.number().int().min(0),
  deviceId: z.string().min(1)
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

  const updatedSession = await supabase
    .from("sessions")
    .update({ status: "running", started_at: new Date().toISOString(), paused_at: null, ended_at: null })
    .eq("id", timerState.active_session_id)
    .select("*")
    .single();

  if (updatedSession.error) return serverError(updatedSession.error.message);

  const updatedTimer = await supabase
    .from("timer_states")
    .update({
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
