/** Short name for compact labels and pills ("Dr. Priya" -> "Priya", "Prem Anand" -> "Prem"). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0].toLowerCase().replace(/\.$/, '');
  return first === 'dr' && parts.length > 1 ? parts[1] : parts[0];
}

/** Up to two initials of a person's name ("Priya Sharma" -> "PS"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}
