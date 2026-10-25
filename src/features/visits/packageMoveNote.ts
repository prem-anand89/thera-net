import { formatINR, roundToRupeeHalfUp, type Paise } from '@/domain/money';

/**
 * The one line New Visit shows when a package session moves part of the biller's package money to
 * someone else: the runner (who keeps the session minus any helper's part) and the helper, if any.
 * `amountPaise` is the session's share (post-tax). null when nothing leaves the biller.
 */
export function packageMoveNote(opts: {
  amountPaise: Paise;
  biller: { id: string; name: string };
  runner: { id: string; name: string };
  helper?: { id: string; name: string; pct: number } | null;
}): string | null {
  const { amountPaise, biller, runner, helper } = opts;
  if (amountPaise <= 0) return null;
  const part = helper && helper.id !== runner.id ? roundToRupeeHalfUp((amountPaise * helper.pct) / 100) : 0;
  const to: string[] = [];
  const runnerAmount = amountPaise - part;
  if (runner.id !== biller.id && runnerAmount > 0) to.push(`${formatINR(runnerAmount)} to ${runner.name}`);
  if (helper && part > 0 && helper.id !== biller.id) to.push(`${formatINR(part)} to ${helper.name}`);
  if (to.length === 0) return null;
  const total = to.length === 2 || !helper ? formatINR(amountPaise) : formatINR(runner.id !== biller.id ? runnerAmount : part);
  return `${total} of ${biller.name}'s package moves for this session: ${to.join(' and ')}.`;
}
