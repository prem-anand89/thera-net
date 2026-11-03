import { useCallback, useState } from 'react';

/** Which list the switch belongs to. Each list remembers its own choice. */
export type UsageList = 'services' | 'treatments';

const key = (list: UsageList) => `theranet:show-usage:${list}`;

function read(list: UsageList): boolean {
  try {
    return window.localStorage.getItem(key(list)) === '1';
  } catch {
    return false;
  }
}

/**
 * "Show usage" on a Settings list: a view switch, not a setting. Off by default, remembered on this device only
 * (localStorage; a blocked store just means off), never synced and never a clinic-wide choice.
 */
export function useShowUsage(list: UsageList): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => read(list));
  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      try {
        if (next) window.localStorage.setItem(key(list), '1');
        else window.localStorage.removeItem(key(list));
      } catch {
        // Storage blocked (private window, settings): the switch still works for this visit.
      }
    },
    [list]
  );
  return [on, set];
}
