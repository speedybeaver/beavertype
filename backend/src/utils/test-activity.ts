import type {
  CountByYearAndDay,
  TestActivity,
} from "@monkeytype/schemas/users";
import { MILLISECONDS_IN_DAY } from "@monkeytype/util/date-and-time";

const daysInYear = (year: number): number =>
  (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / MILLISECONDS_IN_DAY;

/** Add one test on the (UTC) day of `timestamp`, in place. */
export function incrementTestActivity(
  activity: CountByYearAndDay,
  timestamp: number,
): void {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const day =
    (Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(year, 0, 1)) /
    MILLISECONDS_IN_DAY;
  const days = (activity[year] ??= []);
  while (days.length <= day) days.push(null);
  days[day] = (days[day] ?? 0) + 1;
}

/** Last 372 days of activity, for the activity graph. Port of upstream. */
export function generateCurrentTestActivity(
  activity: CountByYearAndDay,
  now = Date.now(),
): TestActivity | undefined {
  const year = new Date(now).getUTCFullYear();
  let thisYear = activity[year];
  let lastYear = activity[year - 1];
  if (thisYear === undefined && lastYear === undefined) return undefined;
  thisYear = thisYear ?? [];
  lastYear = [...(lastYear ?? [])];
  while (lastYear.length < daysInYear(year - 1)) lastYear.push(null);
  lastYear = lastYear.slice(-372 + thisYear.length);
  return {
    testsByDays: [...lastYear, ...thisYear],
    lastDay: Date.UTC(year, 0, 1) + (thisYear.length - 1) * MILLISECONDS_IN_DAY,
  };
}
