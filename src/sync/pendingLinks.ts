import { db } from '@/lib/db';

/**
 * Appointment → visit links waiting to reach the server.
 *
 * Saving a visit started from an appointment must also link the two
 * (`link_appointment_visit`: visit_id, patient_id, status 'arrived'). That RPC
 * needs the visit row to already exist server-side (appointments.visit_id is
 * a foreign key), and the visit itself only syncs on the next push — so
 * calling it straight after the local save failed every time, and offline it
 * could never work. The link is queued here instead (persisted in `meta`, so
 * a reload or restart doesn't lose it) and the sync engine sends it right
 * after the visit has been pushed.
 */
export interface PendingAppointmentLink {
  appointmentId: string;
  visitId: string;
  patientId: string;
}

const KEY = 'pendingAppointmentLinks';

export async function listPendingLinks(): Promise<PendingAppointmentLink[]> {
  const raw = (await db.meta.get(KEY))?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PendingAppointmentLink[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function write(links: PendingAppointmentLink[]): Promise<void> {
  if (links.length === 0) await db.meta.delete(KEY);
  else await db.meta.put({ key: KEY, value: JSON.stringify(links) });
}

export async function enqueueAppointmentLink(link: PendingAppointmentLink): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const links = (await listPendingLinks()).filter((l) => l.appointmentId !== link.appointmentId);
    await write([...links, link]);
  });
}

export async function removePendingLink(appointmentId: string): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await write((await listPendingLinks()).filter((l) => l.appointmentId !== appointmentId));
  });
}

/**
 * The appointment as this device should show it while its link is pending:
 * already linked and arrived, so it leaves the Today "in progress" list at
 * once instead of looking unfinished (and being logged a second time).
 */
export function withPendingLinks<T extends { id: string; visitId?: string | null; patientId?: string | null; status: string }>(
  appointments: T[],
  links: PendingAppointmentLink[]
): T[] {
  if (links.length === 0) return appointments;
  const byAppointment = new Map(links.map((l) => [l.appointmentId, l]));
  return appointments.map((a) => {
    const link = byAppointment.get(a.id);
    // A cancelled / no-show appointment can't be linked (the server rejects
    // it), so never show one as arrived on the strength of a pending link.
    if (!link || a.visitId || a.status === 'cancelled' || a.status === 'no_show') return a;
    return { ...a, visitId: link.visitId, patientId: a.patientId ?? link.patientId, status: 'arrived' };
  });
}

/** Errors that mean this link can never succeed — drop it rather than retry. */
export function isPermanentLinkError(message: string): boolean {
  return /already has a linked visit|no longer be linked|not found|not authorized/i.test(message);
}
