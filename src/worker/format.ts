import type { Category, ReviewSubmission, Turn } from "../shared/types";

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

/** One row per response. Each analysis category gets its own column, so the file follows the campaign. */
export function toCsv(rows: ReviewSubmission[], categories: Category[]): string {
  const header = ["date", "mode", "role", "ease", "context", "sentiment", "summary", ...categories.map((category) => category.label), "needs_attention", "participant_words", "full_transcript"];
  const lines = rows.map((row) =>
    [
      new Date(row.createdAt * 1000).toISOString().slice(0, 10),
      row.mode,
      row.role,
      row.ease,
      row.context.join("; "),
      row.analysis?.sentiment || "",
      row.analysis?.summary || "",
      ...categories.map((category) => (row.analysis?.points || []).filter((point) => point.category === category.id).map((point) => `[${point.theme}] ${point.point}`).join(" | ")),
      row.analysis?.needsAttention ? row.analysis.attentionNote : "",
      row.transcript.filter((turn) => turn.role === "participant").map((turn) => turn.text).join("\n\n"),
      row.transcript.map((turn) => `${turn.role === "guide" ? "Guide" : "Participant"}: ${turn.text}`).join("\n\n"),
    ].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}
