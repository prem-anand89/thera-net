import type { ReactNode } from 'react';

/** Small stroke icons for the Workspace header — same language as
 *  `NavIcons.tsx` (currentColor, ~1.6px stroke, round caps, no fill). */
type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="1.6"
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
      <path d="M6 4.5h8M6 8h8M6 4.5h2.5a3.5 3.5 0 010 7H6l6 5" />
    </Svg>
  );
}

export function IconVisits(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="3.5" width="11" height="13" rx="1.8" />
      <path d="M7.5 3.5V5h5V3.5M7.5 9.5l1.7 1.7 3.3-3.4M7.5 13.5h5" />
    </Svg>
  );
}

export function IconTrend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 16.5h13M5.5 13.5v-2M9 13.5V8.5M12.5 13.5v-4M16 13.5V5" />
    </Svg>
  );
}

export function IconPackage(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 3l6.5 3.3L10 9.6 3.5 6.3 10 3zM3.5 10L10 13.3l6.5-3.3M3.5 13.7L10 17l6.5-3.3" />
    </Svg>
  );
}

export function IconUserPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="7" r="2.8" />
      <path d="M3 16.5c.6-2.7 2.6-4.2 5-4.2s4.4 1.5 5 4.2M15 6.5v4M13 8.5h4" />
    </Svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2.8v1.5M10 15.7v1.5M2.8 10h1.5M15.7 10h1.5M4.9 4.9l1 1M14.1 14.1l1 1M4.9 15.1l1-1M14.1 5.9l1-1" />
    </Svg>
  );
}

export function IconMonth(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="13" height="12" rx="2" />
      <path d="M3.5 8.5h13M7 3v3M13 3v3M7 11.5h1M11.5 11.5h1M7 14h1" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 4.5v11M4.5 10h11" />
    </Svg>
  );
}

export function IconBook(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="13" height="12" rx="2" />
      <path d="M3.5 8.5h13M7 3v3M13 3v3M10 10.8v3.4M8.3 12.5h3.4" />
    </Svg>
  );
}

export function IconTasks(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5.5h8.5M8 10h8.5M8 14.5h8.5M3.5 5.5h1M3.5 10h1M3.5 14.5h1" />
    </Svg>
  );
}

export function IconCheckCircle(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M7.3 10.2l1.9 1.9 3.6-3.8" />
    </Svg>
  );
}

export function IconCloud(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 15.5h8.2a3.3 3.3 0 00.4-6.6A4.6 4.6 0 005.7 8a3.8 3.8 0 00.3 7.5z" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5l5 5-5 5" />
    </Svg>
  );
}
