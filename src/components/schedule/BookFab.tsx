/** Phone "book an appointment" round button, floating above the bottom nav. */
export function BookFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Book appointment"
      onClick={onClick}
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom)+0.75rem)] right-4 z-[9] flex h-14 w-14 items-center justify-center rounded-full bg-[var(--teal)] text-white shadow-lg active:bg-[var(--teal-strong)]"
    >
      <svg aria-hidden className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}
