/** One CSV cell. A leading = + - @ is prefixed with ' so spreadsheet programs never run it as a formula. */
export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
export const toCsv = (columns: string[], rows: Record<string, unknown>[]): string =>
  [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n");
