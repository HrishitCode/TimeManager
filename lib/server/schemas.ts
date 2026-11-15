import { z } from "zod";
import { isValidTimeZone } from "@/lib/shared/time";

/** Any ISO-8601 instant with offset → normalised UTC ISO string. */
export const isoInstant = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const uuid = z.string().uuid();
export const optUuid = uuid.nullable().optional();
export const timezone = z.string().refine(isValidTimeZone, "Unknown time zone");
export const title = z.string().trim().min(1).max(200);
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected #rrggbb");
