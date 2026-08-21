const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function allDayIsoFromDateKey(value: string): string | undefined {
  if (!DATE_KEY_PATTERN.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || allDayDateKeyFromIso(date.toISOString()) !== value) {
    return undefined;
  }
  return date.toISOString();
}

export function allDayDateKeyFromIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid all-day date: ${value}`);
  }
  return utcDateKey(date);
}

export function addDaysToDateKey(value: string, amount: number): string {
  const iso = allDayIsoFromDateKey(value);
  if (!iso) {
    throw new Error(`Invalid date key: ${value}`);
  }
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + amount);
  return utcDateKey(date);
}

function utcDateKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
