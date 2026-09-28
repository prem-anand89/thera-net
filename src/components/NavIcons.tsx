/** Minimal stroke icons, one per main nav item — same visual language as
 *  the existing hamburger/close glyphs (currentColor, ~1.6px stroke,
 *  round caps, no fill). */
export function IconWorkspace({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3.5 9.5L10 4l6.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 8.5V15a1 1 0 001 1h3v-4.5h1V16h3a1 1 0 001-1V8.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function IconLedger({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="4.5" y="3" width="11" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7 7.2h6M7 10h6M7 12.8h3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function IconPatients({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="7.3" cy="6.3" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="13.2" cy="7" r="1.9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M2.5 16c.5-3 2.5-4.7 4.8-4.7s4.3 1.7 4.8 4.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M12.3 11.6c1.9.2 3.4 1.7 3.8 4.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function IconReports({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M4 16.5V11M10 16.5V4M16 16.5V8.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M3 16.5h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
export function IconSettings({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M4 5.5h7.5M4 10h11M4 14.5h7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle
        cx="14"
        cy="5.5"
        r="1.7"
        fill="var(--surface)"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="8.5"
        cy="14.5"
        r="1.7"
        fill="var(--surface)"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}
export function IconRequests({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3 5.5h14v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-9zM3 5.5l3.5 4.2h7L17 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function IconMore({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="5" cy="10" r="1.4" fill="currentColor" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" />
      <circle cx="15" cy="10" r="1.4" fill="currentColor" />
    </svg>
  );
}
