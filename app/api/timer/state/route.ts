import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api/auth";
import { serverError, unauthorized } from "@/lib/api/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) return unauthorized();

  const supabase = createSupabaseAdminClient();
  const timerStateResult = await supabase
    .from("timer_states")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (timerStateResult.error) {
    if (timerStateResult.error.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "Database schema is not initialized. Run supabase/migrations/0001_init.sql in your Supabase SQL editor."
        },
        { status: 503 }
      );
    }
    return serverError(timerStateResult.error.message);
  }
  let timerState = timerStateResult.data;

  if (!timerState) {
    const inserted = await supabase
      .from("timer_states")
      .insert({ user_id: user.id, state_version: 0, active_session_id: null, updated_by_device_id: "bootstrap" })
      .select("*")
      .single();
    if (inserted.error) return serverError(inserted.error.message);
    timerState = inserted.data;
  }

  let activeSession = null;
  if (timerState.active_session_id) {
    const { data: session } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", timerState.active_session_id)
      .eq("user_id", user.id)
      .maybeSingle();
    activeSession = session;
  }

  return NextResponse.json({ timerState, activeSession });
}
