import type { AgendaItem } from "@/db/schema";

function localMinute(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (key: string) => parts.find((part) => part.type === key)!.value;
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

export function programStatus(
  items: AgendaItem[],
  startsAt: string,
  timezone: string,
  now: Date,
) {
  const day = localMinute(new Date(startsAt), timezone).slice(0, 10);
  const minute = localMinute(now, timezone);
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const current = sorted.find(
    (item) => `${day}T${item.start}` <= minute && minute < `${day}T${item.end}`,
  );
  const next = sorted.find((item) => `${day}T${item.start}` > minute);
  const state = current
    ? "during"
    : !sorted.length
      ? "empty"
      : minute < `${day}T${sorted[0].start}`
        ? "before"
        : next
          ? "gap"
          : "after";
  return { current, next, state };
}
