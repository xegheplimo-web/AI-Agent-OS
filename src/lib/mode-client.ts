/* Client-safe mode hint baked at build time. */
export function isDemoModeClient(): boolean {
  return (process.env.NEXT_PUBLIC_APP_MODE ?? "demo") === "demo";
}
