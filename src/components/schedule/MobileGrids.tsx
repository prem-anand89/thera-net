import { ResourceDayGrid, WeekTimeGrid } from './TimeGrid';
import { phonePxPerMinute, phoneSingleColumnPxPerMinute } from '@/features/schedule/schedulePhoneHelpers';

type ResourceProps = React.ComponentProps<typeof ResourceDayGrid>;
type WeekProps = React.ComponentProps<typeof WeekTimeGrid>;

/**
 * Phone Day view: one column per therapist. The shared grid does the work
 * (geometry, overlap lanes, Now line, free slots, long-press move); this only
 * switches on the phone presentation and the tap-size scale.
 */
export function MobileDayGrid(props: Omit<ResourceProps, 'phone' | 'pxPerMinute'>) {
  // One therapist = one wide column with an in-column hour rail and a denser scale.
  const single = props.therapists.length === 1;
  return (
    <ResourceDayGrid
      {...props}
      phone
      pxPerMinute={single ? phoneSingleColumnPxPerMinute(props.slotMinutes) : phonePxPerMinute(props.slotMinutes)}
    />
  );
}

/** Phone 3-Day view: one therapist, three date columns. `days` must hold the 3 dates. */
export function MobileThreeDayGrid(props: Omit<WeekProps, 'phone' | 'pxPerMinute'>) {
  return <WeekTimeGrid {...props} phone pxPerMinute={phonePxPerMinute(props.slotMinutes)} />;
}
