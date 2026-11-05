import { useCallback, useState } from 'react';

/** Which list the switch belongs to. Each list remembers its own choice. */
export type UsageList = 'services' | 'treatments';

const key = (list: UsageList) => `theranet:show-usage:${list}`;

function read(list: UsageList): boolean {
  try {
    return window.localStorage.getItem(key(list)) !== '0';
  } catch {
    return true;
  }
}

/**
 * "Show usage" on a Settings list: a view switch, not a setting. On by default (the admin is the only one who sees these lists), remembered on this device only
 * (localStorage; a blocked store just means on), never synced and never a clinic-wide choice.
 */
export function useShowUsage(list: UsageList): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => read(list));
  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      try {
        if (next) window.localStorage.removeItem(key(list));
        else window.localStorage.setItem(key(list), '0');
      } catch {
        // Storage blocked (private window, settings): the switch still works for this visit.
      }
    },
    [list]
  );
  return [on, set];
}
