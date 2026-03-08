import { differenceInSeconds } from "date-fns";

export const calculateActualDurationSec = (
  startedAtIso: string,
  endedAtIso: string,
  existingSec = 0
): number => {
  const segment = differenceInSeconds(new Date(endedAtIso), new Date(startedAtIso));
  return Math.max(0, existingSec + segment);
};
