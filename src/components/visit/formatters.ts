/** Combines catalog treatment picks with the free-text add-on into one
 *  display string for the single "Treatments" column/cell — e.g. "Manual
 *  Therapy, Exercise Therapy — FM An/Re S,S". Either half can be absent. */
export function treatmentsDisplayText(
  treatmentNames: string[],
  treatmentNotes: string | null
): string {
  const parts = [];
  if (treatmentNames.length) parts.push(treatmentNames.join(', '));
  if (treatmentNotes) parts.push(treatmentNotes);
  return parts.join(' — ') || '—';
}

/** ID · age · sex under the name, matching New visit's Patient panel. */
export function patientIdentityLine(
  mrno: string,
  age?: number | null,
  sex?: 'M' | 'F' | 'Other' | null
): string {
  const parts = [mrno];
  if (age != null) parts.push(`${age}y`);
  if (sex) parts.push(sex);
  return parts.join(' · ');
}
