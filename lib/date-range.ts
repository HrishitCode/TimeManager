import { endOfDay, endOfMonth, endOfWeek, endOfYear, parseISO, startOfDay, startOfMonth, startOfWeek, startOfYear } from "date-fns";

export type InsightRange = "day" | "week" | "month" | "year";

export const getRangeWindow = (range: InsightRange, anchorIso: string) => {
  const anchor = parseISO(anchorIso);
  switch (range) {
    case "day":
      return { start: startOfDay(anchor), end: endOfDay(anchor) };
    case "week":
      return { start: startOfWeek(anchor, { weekStartsOn: 1 }), end: endOfWeek(anchor, { weekStartsOn: 1 }) };
    case "month":
      return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
    case "year":
      return { start: startOfYear(anchor), end: endOfYear(anchor) };
  }
};
