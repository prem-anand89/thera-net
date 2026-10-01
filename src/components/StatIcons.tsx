import type { ReactNode } from 'react';

/** Stroke icons for the Workspace header. Drawn on a 24px grid edge to edge
 *  (2px margin) with a 2px stroke, so they read clearly at 18–22px inside
 *  a badge — the earlier 20px set sat in the middle ~12px of its box and
 *  looked small. currentColor, round caps, no fill. */
type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function IconRupee(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4h12M6 9h12M9 4h1.5a5 5 0 010 10H6l8.5 7" />
    </Svg>
  );
}

/** Clipboard with a tick — a visit logged. */
export function IconVisits(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V6a2 2 0 00-2-2h-2" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 14l2 2 4-4" />
    </Svg>
  );
}

/** Rising bars with an arrow — net earnings this month. */
export function IconTrend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 21V15M10 21v-8M16 21v-5M3 21h18M4 10l6-5 4 3 7-6M16 2h5v5" />
    </Svg>
  );
}

/** Stacked layers — sessions in a package. */
export function IconPackage(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 12l10 5 10-5M2 17l10 5 10-5" />
    </Svg>
  );
}

export function IconUserPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-1a6 6 0 016-6h2a6 6 0 016 6v1M19 8v6M16 11h6" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** Calendar with a plus — book an appointment. */
export function IconBook(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4M12 13v6M9 16h6" />
    </Svg>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </Svg>
  );
}

export function IconPen(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
    </Svg>
  );
}

export function IconStar(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z" />
    </Svg>
  );
}

export function IconCheckCircle(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l3 3 5-6" />
    </Svg>
  );
}

export function IconCloud(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 19h10.5a4.5 4.5 0 00.5-9 6 6 0 00-11.6-1.5A5.3 5.3 0 007 19z" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-1a6 6 0 016-6h2a6 6 0 016 6v1M16 3.1a4 4 0 010 7.8M22 21v-1a6 6 0 00-4-5.7" />
    </Svg>
  );
}

export function IconMore(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </Svg>
  );
}

/** Banknote with a ₹ — money collected at the desk today. */
export function IconBanknote(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M9.5 9h5M9.5 11.5h5M11 9a2.5 2.5 0 010 5H9.5l3.5 2.5" />
      <path d="M5.5 9v.01M18.5 15v.01" />
    </Svg>
  );
}

/** Wallet — the therapist's net earnings this month. */
export function IconWallet(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 7V5.5A1.5 1.5 0 0017.5 4H5a2 2 0 000 4h14a2 2 0 012 2v3" />
      <path d="M3 6v12a2 2 0 002 2h14a2 2 0 002-2v-3" />
      <path d="M21 13h-4a2 2 0 000 4h4v-4z" />
    </Svg>
  );
}

/** Patient with a tick — a visit seen. */
export function IconUserCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-1a6 6 0 016-6h2a6 6 0 016 6v1M16 11l2 2 4-4" />
    </Svg>
  );
}
