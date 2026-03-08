import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { badRequest, conflict, serverError, unauthorized } from "@/lib/api/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const schema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  mode: z.enum(["focus", "short_break", "long_break"]),
  plannedDurationSec: z.number().int().positive(),
  initialElapsedSec: z.number().int().min(0).optional(),
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

  const timerStateResult = await supabase
    .from("timer_states")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (timerStateResult.error) return serverError(timerStateResult.error.message);

  let timerState = timerStateResult.data;
  if (!timerState) {
    const created = await supabase
      .from("timer_states")
      .insert({ user_id: user.id, state_version: 0, active_session_id: null, updated_by_device_id: parsed.data.deviceId })
      .select("*")
      .single();
    if (created.error) return serverError(created.error.message);
    timerState = created.data;
  }

  if (timerState.state_version !== parsed.data.stateVersion) {
    return conflict("Timer state changed on another device. Refresh and retry.");
  }

  const sessionResult = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      task_id: parsed.data.taskId ?? null,
      project_id: parsed.data.projectId,
      mode: parsed.data.mode,
      status: "running",
      started_at: new Date().toISOString(),
      planned_duration_sec: parsed.data.plannedDurationSec,
      actual_duration_sec: parsed.data.initialElapsedSec ?? 0
    })
    .select("*")
    .single();

  if (sessionResult.error) return serverError(sessionResult.error.message);

  const updateResult = await supabase
    .from("timer_states")
    .update({
      active_session_id: sessionResult.data.id,
      state_version: timerState.state_version + 1,
      updated_by_device_id: parsed.data.deviceId
    })
    .eq("user_id", user.id)
    .eq("state_version", timerState.state_version)
    .select("*")
    .single();

  if (updateResult.error) return conflict("Concurrent timer update detected");

  return NextResponse.json({ timerState: updateResult.data, activeSession: sessionResult.data });
}
