export function formatAcreFeet(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "—" : Math.round(value).toLocaleString("en-US");
}

export function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

export function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC"
  });
}
