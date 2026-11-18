// The patient's link, on the program card: whether it is on, when it was last opened, and the link actions (copy,
// WhatsApp, reset PIN, stop sharing). The parent owns the confirm dialogs; this only reports the taps.
import { Button } from '@/components/Button';
import type { ProgramBundle } from '@/services/hepService';
import { formatDateDM } from '@/domain/fiscalYear';

const linkBtn = 'text-xs font-medium text-[var(--teal)] disabled:opacity-50';

/** "Patient link on · opened today 09:10 · PIN set" (or "No PIN needed"), in the clinic's zone. */
export function linkStatusLabel(access: ProgramBundle['access'], today: string, timeZone: string, requirePin = true): string {
  if (!access) return 'Not shared yet';
  if (access.linkRevoked) return 'Sharing stopped';
  let opened = 'not opened yet';
  if (access.lastOpenedAt) {
    const at = new Date(access.lastOpenedAt);
    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
    opened = dayOf === today ? `opened today ${time}` : `opened ${formatDateDM(dayOf)}`;
  }
  return `Patient link on · ${opened} · ${requirePin ? 'PIN set' : 'No PIN needed'}`;
}

export function ProgramLinkLine(props: {
  access: ProgramBundle['access'];
  today: string;
  timeZone: string;
  online: boolean;
  whatsAppUrl: string;
  requirePin?: boolean;
  pin?: string | null;
  pinLoading?: boolean;
  onTogglePin?: () => void;
  onCopy: () => void;
  onResetPin: () => void;
  onStop: () => void;
}) {
  const { access, online, requirePin = true } = props;
  const sharing = !!access && !access.linkRevoked;
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-[var(--border)] pt-2.5 text-sm">
      <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ink)]">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${sharing ? 'bg-[var(--teal)]' : 'bg-[var(--muted)]'}`} />
        <span>{linkStatusLabel(access, props.today, props.timeZone, requirePin)}</span>
      </span>
      {sharing && <Button type="button" className={linkBtn} onClick={props.onCopy}>Copy link</Button>}
      {sharing && <a href={props.whatsAppUrl} target="_blank" rel="noreferrer" className={linkBtn}>Send on WhatsApp</a>}
      {sharing && requirePin && props.onTogglePin && (
        props.pin !== undefined ? (
          <span className="inline-flex items-center gap-2 text-xs text-[var(--ink)]">
            {props.pin ? (
              <>PIN: <strong className="font-num tracking-wider">{props.pin}</strong></>
            ) : (
              <span className="text-[var(--muted)]">PIN not saved (reset to view)</span>
            )}
            <Button type="button" className={linkBtn} onClick={props.onTogglePin}>Hide</Button>
          </span>
        ) : (
          <Button type="button" className={linkBtn} disabled={!online || props.pinLoading} onClick={props.onTogglePin}>
            {props.pinLoading ? 'Loading PIN…' : 'Show PIN'}
          </Button>
        )
      )}
      {requirePin && <Button type="button" className={linkBtn} disabled={!online} onClick={props.onResetPin}>Reset PIN…</Button>}
      {sharing && <Button type="button" className="text-xs font-medium text-[var(--rust)] disabled:opacity-50" disabled={!online} onClick={props.onStop}>Stop sharing</Button>}
    </div>
  );
}
