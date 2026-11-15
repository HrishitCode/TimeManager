import { notFound, route } from "@/lib/server/http";
import { describeInvite } from "@/lib/server/services/workspace";

/** Public: lets the join page show "Asha invited you to 'DSA grind'" before sign-up. */
export const GET = route<{ params: Promise<{ code: string }> }>(async (_req, { params }) => {
  const { code } = await params;
  const invite = await describeInvite(code);
  if (!invite) throw notFound("Invite not found");
  return {
    workspace_name: invite.workspace_name,
    inviter: invite.inviter,
    valid: !invite.used_at && new Date(invite.expires_at).getTime() > Date.now()
  };
});
