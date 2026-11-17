/**
 * YYYY-MM-DD of `d` in the browser's own timezone. `toISOString()` gives the
 * UTC day instead, which in WIB is still yesterday until 07:00.
 */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
