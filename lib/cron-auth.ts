import { NextRequest } from "next/server";

const getBearerToken = (authorizationHeader: string | null) => {
  if (!authorizationHeader) return "";
  if (!authorizationHeader.toLowerCase().startsWith("bearer ")) return "";
  return authorizationHeader.slice(7).trim();
};

export const isAuthorizedCronRequest = (request: NextRequest) => {
  const expectedSecret = process.env.REMINDER_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!expectedSecret) return false;

  const headerSecret = request.headers.get("x-reminder-secret") ?? "";
  if (headerSecret && headerSecret === expectedSecret) return true;

  const bearer = getBearerToken(request.headers.get("authorization"));
  return Boolean(bearer && bearer === expectedSecret);
};
