import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export function isValidTimeZone(tz: string | null): tz is string {
  if (!tz) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Calendar YYYY-MM-DD for an instant in `tz` (Intl — no dayjs TZ edge cases). */
export function toLocalYmd(instant: string | Date, tz: string): string | null {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) {
    const m = String(instant).match(/^(\d{4}-\d{2}-\d{2})/);
    return m?.[1] ?? null;
  }
  try {
    // en-CA → YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Start of calendar day in `tz`, as UTC ISO string. */
export function utcStartOfDayInTz(dateStr: string, tz: string): string {
  return dayjs.tz(dateStr, tz).startOf("day").utc().toISOString();
}

/** End of calendar day in `tz`, as UTC ISO string. */
export function utcEndOfDayInTz(dateStr: string, tz: string): string {
  return dayjs.tz(dateStr, tz).endOf("day").utc().toISOString();
}

/** True when `instant` falls on a calendar day between dateFrom..dateTo in `tz`. */
export function isInstantInLocalDateRange(
  instant: string | null | undefined,
  dateFrom: string,
  dateTo: string,
  tz: string
): boolean {
  if (!instant || !dateFrom || !dateTo) return false;
  const day = toLocalYmd(instant, tz);
  if (!day) return false;
  return day >= dateFrom && day <= dateTo;
}

export function resolveDateRangeParams(
  searchParams: URLSearchParams,
  defaultTz: string
): { startDate: string; endDate: string; tz: string; startUtc: string; endUtc: string } | { error: string } {
  const startDate = searchParams.get("start_date")?.trim();
  const endDate = searchParams.get("end_date")?.trim();
  if (!startDate || !endDate) {
    return { error: "start_date and end_date are required" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { error: "Invalid date format (use YYYY-MM-DD)" };
  }
  if (startDate > endDate) {
    return { error: "start_date must be on or before end_date" };
  }

  const tzParam = searchParams.get("tz");
  const tz = isValidTimeZone(tzParam) ? tzParam : defaultTz;

  return {
    startDate,
    endDate,
    tz,
    startUtc: utcStartOfDayInTz(startDate, tz),
    endUtc: utcEndOfDayInTz(endDate, tz),
  };
}
