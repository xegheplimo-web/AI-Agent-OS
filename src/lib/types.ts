/* Shared DTO types between API routes and client components.          */
/* Contract-validated types are re-exported from the Zod contracts;    */
/* display-only shapes that are not parse-critical stay local.         */

export type {
  ApprovalDTO,
  AuditDTO,
  AuditLogDTO,
  AuditStageDTO,
  AuditStageStatus,
  EventDTO,
  FindingDTO,
  JobDTO,
  ParityCheckDTO,
  ParityReportDTO,
  RunAuditRequest,
  SearchResult,
} from "@/lib/contracts";

import type { AuditDTO } from "@/lib/contracts";

export type ComponentStatus = "healthy" | "degraded" | "offline" | "readonly";

export interface ComponentDTO {
  id: string;
  name: string;
  role: string;
  group: string;
  status: ComponentStatus;
  latencyMs: number | null;
  uptimePct: number;
  version: string;
  description: string;
  position: { x: number; y: number } | null;
  metrics: Record<string, string | number>;
}

export interface SystemHealthDTO {
  status: ComponentStatus;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
  uptimePct: string;
  agentsOnline: number;
  agentsTotal: number;
  workersIdle: number;
  workersTotal: number;
  queueDepth: number;
  latencyP95: number;
}

/* Provenance of the telemetry payload. The UI must never display fabricated
 * numbers without disclosing their source, and must never claim a live OTLP
 * feed when none exists.
 *
 *   "otlp"        — a real collector ingested the points backing `current`.
 *                   Only set when the system actually received OTLP records.
 *   "synthetic"   — demo-mode random-walk sampler produced the points. The
 *                   numbers are real rows in telemetry_points, but their
 *                   origin is a Math.sin/random-walk generator, not the app.
 *   "unavailable" — no collector and no sampler ran. `current` is null and
 *                   the charts have no data. This is the honest state for a
 *                   production deployment with no OTLP wiring. */
export type TelemetrySource = "otlp" | "synthetic" | "unavailable";

export interface TelemetrySummaryDTO {
  source: TelemetrySource;
  /* null when source === "unavailable" — there is genuinely no current
   * reading, and a 0/fallback would be a false signal. */
  current: {
    latencyP95: number;
    latencyP50: number;
    throughput: number;
    errorRate: number;
    queueDepth: number;
  } | null;
  series: {
    latencyP95: Array<{ ts: string; value: number }>;
    latencyP50: Array<{ ts: string; value: number }>;
    throughput: Array<{ ts: string; value: number }>;
    errorRate: Array<{ ts: string; value: number }>;
  };
  /* null when source === "unavailable" — the radar panel is decorative and
   * must not render fabricated traces/metrics/logs counts. */
  radar: {
    traces: { active: number; sampledPct: number };
    metrics: { series: number; scrapeOk: number };
    logs: { linesPerMin: number; errorLines: number };
    baggage: { keys: number; propagationPct: number };
  } | null;
}

export interface ArtifactDTO {
  id: number;
  auditId: string | null;
  kind: string;
  format?: string;
  title: string;
  path: string;
  mimeType?: string;
  sizeBytes?: number;
  sizeKb: number;
  sha256?: string;
  generator?: string;
  generatorVersion?: string;
  schemaVersion?: string;
  tags: string[];
  updatedAt: string;
  content?: string;
}

export interface GraphNodeDTO {
  id: string;
  type: "agent" | "hermes" | "auditor";
  position: { x: number; y: number };
  data: {
    label: string;
    subtitle: string;
    status: ComponentStatus;
    icon: string;
    latencyMs: number | null;
    metrics: Record<string, string | number>;
    tag?: string;
  };
}

export interface GraphEdgeDTO {
  id: string;
  source: string;
  target: string;
  kind: "runtime" | "audit";
  sourceHandle?: string;
  targetHandle?: string;
}

export interface ArchitectureGraphDTO {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
}

export interface SettingsDTO {
  production_rules: Array<{ key: string; label: string; icon: string; tone: string; enabled: boolean }>;
  workspace: {
    refreshIntervalMs: number;
    animationsEnabled: boolean;
    clockFormat: "utc" | "local";
    sidebarCompact: boolean;
  };
  notifications: {
    auditCompleted: boolean;
    findingCritical: boolean;
    parityWarning: boolean;
  };
}

export interface MeResponse {
  user: {
    username: string;
    displayName: string;
    role: "viewer" | "operator" | "administrator" | string;
    permissions?: string[];
  } | null;
}

export type RunAuditResponse =
  | { approvalRequired: true; approvalId: string; audit: AuditDTO; message: string }
  | { approvalRequired: false; audit: AuditDTO; replayed: boolean };
