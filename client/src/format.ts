// Turn ISO timestamps into friendly text in the visitor's own time zone

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function formatDay(iso: string) {
  return dayFormat.format(new Date(iso));
}

export function formatTimeRange(startIso: string, endIso: string) {
  return `${timeFormat.format(new Date(startIso))} – ${timeFormat.format(new Date(endIso))}`;
}

export function hasStarted(startIso: string) {
  return new Date(startIso).getTime() <= Date.now();
}
