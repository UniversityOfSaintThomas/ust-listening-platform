import type { Turn } from "../shared/types";

/** Trims a value to a string of at most `max` characters. Anything that is not a string becomes "". */
export const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Keeps only well-formed turns, with caps on count and length. */
export function cleanTranscript(value: unknown): Turn[] {
  if (!Array.isArray(value)) return [];
  const turns: Turn[] = [];
  for (const item of value.slice(0, 120)) {
    const record = item as Record<string, unknown> | null;
    const role = record?.role === "guide" ? "guide" : record?.role === "participant" ? "participant" : null;
    const body = text(record?.text, 6000);
    if (role && body) turns.push({ role, text: body });
  }
  return turns;
}

/** Quotes one CSV cell and neutralizes values a spreadsheet would run as a formula. */
export function csvCell(value: string | number | null): string {
  let cell = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}
