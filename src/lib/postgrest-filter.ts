/**
 * Sanitize user text for PostgREST `ilike` filters.
 * Commas and parentheses break `.or()` comma-separated filter strings.
 */
export function sanitizePostgrestIlike(raw: string): string {
  const q = raw.trim().replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  return q.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/** `%term%` for `.ilike(column, pattern)` — empty string if nothing searchable remains. */
export function postgrestIlikePattern(raw: string): string {
  const safe = sanitizePostgrestIlike(raw);
  return safe ? `%${safe}%` : "";
}

/** Double-quoted operand for `.or(col.ilike."%term%")` — safe for commas, apostrophes, etc. */
function postgrestOrIlikeOperand(safeTerm: string): string {
  const pattern = `%${safeTerm.replace(/"/g, '""')}%`;
  return `"${pattern}"`;
}

/** `col.ilike."%term%",col2.ilike."%term%"` for `.or()` — null if term is empty. */
export function postgrestOrIlikeFilters(columns: string[], raw: string): string | null {
  const safe = sanitizePostgrestIlike(raw);
  if (!safe) return null;
  const operand = postgrestOrIlikeOperand(safe);
  return columns.map((col) => `${col}.ilike.${operand}`).join(",");
}
