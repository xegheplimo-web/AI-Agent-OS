"use client";

import type {
  ApprovalDTO,
  ArchitectureGraphDTO,
  ArtifactDTO,
  AuditDTO,
  AuditLogDTO,
  ComponentDTO,
  EventDTO,
  FindingDTO,
  JobDTO,
  MeResponse,
  ParityReportDTO,
  RunAuditRequest,
  RunAuditResponse,
  SearchResult,
  SettingsDTO,
  SystemHealthDTO,
  TelemetrySummaryDTO,
} from "@/lib/types";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  return new ApiError(body?.error ?? `Request failed: ${res.status}`, res.status, body?.code);
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export const api = {
  systemHealth: () => get<SystemHealthDTO>("/api/system/health"),
  components: () => get<ComponentDTO[]>("/api/system/components"),
  graph: () => get<ArchitectureGraphDTO>("/api/architecture/graph"),

  audits: (params?: string) => get<AuditDTO[]>(`/api/audits${params ? `?${params}` : ""}`),
  auditDetail: (id: string) => get<{ audit: AuditDTO; findings: FindingDTO[] }>(`/api/audits/${id}`),
  runAudit: (input?: Partial<RunAuditRequest>) => send<RunAuditResponse>("/api/audits/run", "POST", input ?? {}),

  parityLatest: () => get<ParityReportDTO>("/api/parity/latest"),

  findings: (params?: string) => get<FindingDTO[]>(`/api/findings${params ? `?${params}` : ""}`),
  patchFinding: (id: number, status: string) => send("/api/findings", "PATCH", { id, status }),

  telemetry: () => get<TelemetrySummaryDTO>("/api/telemetry/summary"),

  jobs: () => get<JobDTO[]>("/api/jobs"),
  createJob: (type: string, target: string) => send("/api/jobs", "POST", { type, target }),

  events: (limit = 24, source?: string) =>
    get<EventDTO[]>(`/api/events?limit=${limit}${source ? `&source=${encodeURIComponent(source)}` : ""}`),

  artifacts: () => get<ArtifactDTO[]>("/api/artifacts"),
  artifact: (id: number) => get<ArtifactDTO>(`/api/artifacts/${id}`),

  settings: () => get<SettingsDTO>("/api/settings"),
  putSettings: (section: string, value: unknown) => send("/api/settings", "PUT", { section, value }),

  approvals: (status?: string) => get<ApprovalDTO[]>(`/api/approvals${status ? `?status=${status}` : ""}`),
  decideApproval: (id: string, decision: "approved" | "rejected", reason?: string) =>
    send(`/api/approvals/${id}`, "POST", { decision, reason }),

  auditLogs: (limit = 20) => get<AuditLogDTO[]>(`/api/audit-logs?limit=${limit}`),

  search: (q: string) => get<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),

  login: (username: string, password: string) => send("/api/auth/login", "POST", { username, password }),
  logout: () => send("/api/auth/logout", "POST"),
  me: () => get<MeResponse>("/api/auth/me"),
};
