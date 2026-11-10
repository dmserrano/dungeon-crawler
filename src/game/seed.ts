/** Parse `?seed=<n>` (default 1). */
export function seedFromSearch(search: string): number {
  const raw = new URLSearchParams(search).get("seed");
  const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n >>> 0 : 1;
}
