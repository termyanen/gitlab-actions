const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export function formatElapsed(createdAt: string, locale?: string) {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - created) / MINUTE_MS));
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const days = Math.floor(hours / HOURS_PER_DAY);
  const unit = (value: number, name: "day" | "hour" | "minute") =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: name,
      unitDisplay: "short",
    }).format(value);
  if (days > 0)
    return unit(days, "day") + " " + unit(hours % HOURS_PER_DAY, "hour");
  if (hours > 0)
    return (
      unit(hours, "hour") + " " + unit(minutes % MINUTES_PER_HOUR, "minute")
    );
  return unit(minutes, "minute");
}
