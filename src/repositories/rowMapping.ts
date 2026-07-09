/**
 * Shallow key-case conversion at the Supabase boundary. Domain objects are
 * camelCase; Postgres columns are snake_case. Conversion is top-level only —
 * jsonb payloads (invoice patient snapshot / line items) keep their own keys.
 */

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function domainToRow(obj: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) row[toSnake(k)] = v;
  // updated_at/created_by/updated_by are server-authoritative (set by the
  // set_updated_at trigger from auth.uid()); never send client values for them
  delete row.updated_at;
  delete row.created_by;
  delete row.updated_by;
  return row;
}

export function rowToDomain<T>(row: Record<string, unknown>): T {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) obj[toCamel(k)] = v;
  return obj as T;
}
