/**
 * Report text is written in the third person with names ("Asha was more disciplined").
 * Rewrite it for the viewer: their own name becomes "You"/"you", with matching grammar.
 */
export const personalize = (text: string, myName?: string): string => {
  if (!myName) return text;
  const n = myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    text
      .replace(new RegExp(`\\b${n} was\\b`, "g"), "you were")
      .replace(new RegExp(`\\b${n}\\b`, "g"), "you")
      // Capitalise at the start of a sentence or after a colon.
      .replace(/(^|[.:] )you\b/g, (_m, p: string) => `${p}You`)
      // "You kept more of their plan" → "your plan" (only when "you" is the subject earlier in the clause).
      .replace(/\b(You|you)\b([^.:,]*?) their\b/g, (_m, y: string, mid: string) => `${y}${mid} your`)
  );
};
