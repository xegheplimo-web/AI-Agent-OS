/* ------------------------------------------------------------------ */
/* APP_MODE: demo | production                                         */
/* demo       → simulated runners advance state inside API requests.   */
/* production → API routes only enqueue; an external worker process    */
/*              (src/worker/index.ts) claims and advances jobs.        */
/* ------------------------------------------------------------------ */

export const APP_MODE = (process.env.APP_MODE ?? "demo") as "demo" | "production";
export const isDemoMode = APP_MODE === "demo";

export interface AuditRunner {
  /** Advance in-flight audits one tick. Demo calls this inline; the
   *  production worker calls it from its own loop. */
  tick(): Promise<void>;
}

export interface JobRunner {
  tick(): Promise<void>;
}

export interface TelemetryProvider {
  sample(): Promise<void>;
}
