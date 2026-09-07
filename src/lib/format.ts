/** Whole minutes → "1h 10m" / "45m" — the one duration format used
 * throughout the app (Timeline, Next Feed, Last Sleep, Dashboard charts). */
export function fmtMinutes(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return h > 0 ? `${h}h ${rem}m` : `${rem}m`;
}

/** Same, from a millisecond duration. */
export function fmtDuration(ms: number): string {
  return fmtMinutes(ms / 60000);
}
