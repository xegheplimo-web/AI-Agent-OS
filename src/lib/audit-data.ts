/* ------------------------------------------------------------------ */
/* Pure data shared between seed script, API routes and client UI.     */
/* ------------------------------------------------------------------ */

export const AUDIT_STAGE_DEFS = [
  {
    key: "discovery",
    label: "Discovery",
    detail: "filesystem, repo, Docker, packages, ports, config, database, queue, MCP",
    artifacts: [
      "raw/host_inventory.json",
      "raw/repo_inventory.json",
      "raw/docker_inspect.json",
      "raw/route_inventory.json",
      "raw/env_matrix.json",
    ],
  },
  {
    key: "normalization",
    label: "Normalization",
    detail:
      "host_inventory.json, repo_inventory.json, dependency_graph.json, service_catalog.json, security_findings.json, architecture_graph.json, parity_report.json",
    artifacts: [
      "normalized/service_catalog.json",
      "normalized/dependency_graph.json",
      "normalized/architecture_graph.json",
      "normalized/security_findings.json",
    ],
  },
  {
    key: "reconstruction",
    label: "Reconstruction",
    detail: "Mermaid / Graphviz, README, SBOM, runbook recovery, monorepo skeleton, CI matrix, parity gates",
    artifacts: [
      "recon/README.md",
      "recon/sbom.cyclonedx.json",
      "recon/architecture.mmd",
      "recon/RUNBOOK.md",
      "recon/parity_report.json",
    ],
  },
] as const;

export const STAGE_DURATION_MS = [4500, 5200, 6200]; // discovery, normalization, reconstruction
export const AUDIT_TOTAL_MS = STAGE_DURATION_MS.reduce((a, b) => a + b, 0);

export const COMPONENT_SEED = [
  {
    id: "hermes",
    name: "Hermes",
    role: "Orchestrator & Coordinator",
    group: "core",
    status: "healthy",
    latencyMs: 34.2,
    uptimePct: 99.99,
    version: "1.4.2",
    position: { x: 440, y: 215 },
    metrics: { activeSessions: 42, tasksPerMin: 312, agentsManaged: 7, policyChecks: "1.2k/h" },
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    role: "UX / Agent Shell",
    group: "agent",
    status: "healthy",
    latencyMs: 18.7,
    uptimePct: 99.97,
    version: "0.9.4",
    position: { x: 40, y: 55 },
    metrics: { sessions: 18, terminals: 4, mcpTools: 26 },
  },
  {
    id: "opencode",
    name: "OpenCode",
    role: "Code & Tool Reasoner",
    group: "agent",
    status: "healthy",
    latencyMs: 61.3,
    uptimePct: 99.95,
    version: "2.1.0",
    position: { x: 795, y: 55 },
    metrics: { repos: 3, patchesToday: 57, toolCalls: "4.8k" },
  },
  {
    id: "gateway",
    name: "Gateway",
    role: "API / Auth / MCP Bridge",
    group: "agent",
    status: "healthy",
    latencyMs: 9.4,
    uptimePct: 99.99,
    version: "1.2.8",
    position: { x: 10, y: 240 },
    metrics: { rps: 1284, authDenied: 2, routes: 38 },
  },
  {
    id: "worker",
    name: "Worker",
    role: "Jobs / Queue Runner",
    group: "agent",
    status: "healthy",
    latencyMs: 22.1,
    uptimePct: 99.91,
    version: "1.1.3",
    position: { x: 815, y: 240 },
    metrics: { workers: 12, queueDepth: 23, running: 6 },
  },
  {
    id: "memory",
    name: "Memory",
    role: "Session / State / Vector Store",
    group: "agent",
    status: "degraded",
    latencyMs: 41.0,
    uptimePct: 99.87,
    version: "0.8.9",
    position: { x: 30, y: 425 },
    metrics: { vectors: "1.2M", sessions: 3420, p99ms: 41 },
  },
  {
    id: "knowledge",
    name: "Knowledge",
    role: "Docs / Search / Corpus",
    group: "agent",
    status: "healthy",
    latencyMs: 27.6,
    uptimePct: 99.96,
    version: "0.7.5",
    position: { x: 815, y: 425 },
    metrics: { docs: 8641, embeddings: "3.4M", searchPerMin: 92 },
  },
  {
    id: "dashboard",
    name: "Dashboard",
    role: "Observability / Approval / Control Plane",
    group: "agent",
    status: "healthy",
    latencyMs: 12.8,
    uptimePct: 99.99,
    version: "1.0.0",
    position: { x: 230, y: 520 },
    metrics: { sseClients: 7, panels: 14, refresh: "3s" },
  },
  {
    id: "auditor",
    name: "AI System Auditor",
    role: "Inventory / Graph / SBOM / Parity / Restore",
    group: "audit",
    status: "readonly",
    latencyMs: 51.8,
    uptimePct: 99.92,
    version: "0.3.1",
    position: { x: 480, y: 530 },
    metrics: { artifacts: 12, coverage: "97%", lastRun: "14m" },
  },
] as const;

export const COMPONENT_DESCRIPTIONS: Record<string, string> = {
  hermes:
    "Central orchestrator. Routes intents between agents, enforces policy gates, coordinates distributed sessions and owns the task DAG for every agent run.",
  openclaw:
    "Agent shell & UX surface. Hosts the terminal UX, MCP tool bridge and operator-facing agent interactions.",
  opencode:
    "Code reasoning agent. Plans patches, runs tool calls against repositories and proposes diffs under human-in-the-loop approval.",
  gateway:
    "Single ingress for REST / WebSocket traffic. AuthN/Z, session policies, request routing to runtime core and audit service.",
  worker:
    "Queue runner fleet. Executes audit jobs, SBOM exports, artifact packaging and scheduled parity gates.",
  memory:
    "Session state and vector store. Persists agent memory, embeddings and cross-session context with p99 < 50ms target.",
  knowledge:
    "Corpus and documentation search. Indexes specs, runbooks and reconstructed artifacts into a searchable knowledge graph.",
  dashboard:
    "This control plane. Read/approve surface for audit reports, parity gates and live telemetry. Never mutates runtime directly.",
  auditor:
    "Independent, read-only system auditor. Lives outside the runtime: discovers, normalizes and reconstructs evidence into signed artifacts.",
};

export const GRAPH_EDGES = [
  { id: "e-openclaw-hermes", source: "openclaw", target: "hermes", kind: "runtime", sourceHandle: "sr", targetHandle: "ttl" },
  { id: "e-opencode-hermes", source: "opencode", target: "hermes", kind: "runtime", sourceHandle: "sl", targetHandle: "ttr" },
  { id: "e-gateway-hermes", source: "gateway", target: "hermes", kind: "runtime", sourceHandle: "sr", targetHandle: "tl" },
  { id: "e-worker-hermes", source: "worker", target: "hermes", kind: "runtime", sourceHandle: "sl", targetHandle: "tr" },
  { id: "e-memory-hermes", source: "memory", target: "hermes", kind: "runtime", sourceHandle: "sr", targetHandle: "tbl" },
  { id: "e-knowledge-hermes", source: "knowledge", target: "hermes", kind: "runtime", sourceHandle: "sl", targetHandle: "tbr" },
  { id: "e-dashboard-hermes", source: "dashboard", target: "hermes", kind: "runtime", sourceHandle: "st", targetHandle: "tbl" },
  { id: "e-auditor-hermes", source: "auditor", target: "hermes", kind: "audit", sourceHandle: "st", targetHandle: "tb" },
  { id: "e-auditor-dashboard", source: "auditor", target: "dashboard", kind: "audit", sourceHandle: "sl", targetHandle: "tr" },
] as const;

export const MONOREPO_TREE = [
  { depth: 0, name: "/agents/openclaw", type: "dir" },
  { depth: 0, name: "/agents/hermes", type: "dir" },
  { depth: 0, name: "/agents/opencode", type: "dir" },
  { depth: 0, name: "/audit-scripts", type: "dir" },
  { depth: 0, name: "/frontend", type: "dir" },
  { depth: 0, name: "/infra", type: "dir" },
  { depth: 0, name: "/docs", type: "dir" },
  { depth: 0, name: "/.github/workflows", type: "dir" },
] as const;

export const PRODUCTION_RULES_DEFAULT = [
  { key: "github_readonly", label: "GitHub: read-only", icon: "github", tone: "cyan", enabled: true },
  { key: "docker_inspect", label: "Docker: inspect only", icon: "container", tone: "cyan", enabled: true },
  { key: "db_select_only", label: "DB: SELECT only", icon: "database", tone: "blue", enabled: true },
  { key: "no_mutate_prod", label: "No mutate on production", icon: "octagon", tone: "red", enabled: true },
  { key: "human_approval", label: "Human-in-the-loop approval", icon: "user-check", tone: "green", enabled: true },
];

export const WORKSPACE_DEFAULT = {
  refreshIntervalMs: 4000,
  animationsEnabled: true,
  clockFormat: "utc" as const,
  sidebarCompact: false,
};

export const NOTIFICATIONS_DEFAULT = {
  auditCompleted: true,
  findingCritical: true,
  parityWarning: true,
};

/* ------------------------------------------------------------------ */
/* Finding pool – rotating subset is attached to each completed audit  */
/* ------------------------------------------------------------------ */
export const FINDING_POOL: Array<{
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  component: string;
  title: string;
  description: string;
  evidence: string;
}> = [
  {
    severity: "critical",
    category: "security",
    component: "gateway",
    title: "Exposed credential material in repository history",
    description:
      "gitleaks detected a high-entropy token pattern committed under /frontend/.env.bak. The gateway image built from this context would embed the secret in layer 7.",
    evidence: "gitleaks: generic-api-key @ frontend/.env.bak:4 — entropy 4.7, sha256:9f86…c21",
  },
  {
    severity: "high",
    category: "security",
    component: "worker",
    title: "CVE-2025-40909 in base image node:20.11-alpine",
    description:
      "trivy scan of worker image flagged openssl 3.3.0 with a remotely exploitable buffer overflow. Fix available in node:20.18-alpine3.21.",
    evidence: "trivy: pkg:apk/openssl@3.3.0-r0 — CVSS 8.1 — fixed in 3.3.3-r0",
  },
  {
    severity: "high",
    category: "schema",
    component: "memory",
    title: "Schema drift vs baseline: audits.finished_at nullability",
    description:
      "Baseline schema declares NOT NULL with default sentinel; current production allows NULL. Parity gate treats this as behavioral drift for unfinished audits.",
    evidence: "diff(schema): audits.finished_at baseline=NOT NULL current=NULL",
  },
  {
    severity: "medium",
    category: "schema",
    component: "dashboard",
    title: "2 missing indexes on hot telemetry paths",
    description:
      "Query planner shows sequential scans on telemetry_points.ts and events.created_at for dashboard polling queries at 3s refresh.",
    evidence: "EXPLAIN: Seq Scan on telemetry_points (rows=48,031) — expected index telem_ts_idx",
  },
  {
    severity: "medium",
    category: "dependency",
    component: "dashboard",
    title: "Deprecated package reactflow pinned in frontend",
    description:
      "Monorepo still ships reactflow@11 which is end-of-life. Migration path to @xyflow/react@12 is documented in the reconstruction README.",
    evidence: "npm ls reactflow → 11.11.4 (deprecated, moved to @xyflow/react)",
  },
  {
    severity: "medium",
    category: "config",
    component: "hermes",
    title: "MCP tool timeout drift (30s vs 45s baseline)",
    description:
      "Hermes runtime applies a 30s tool timeout while the baseline contract declares 45s. Long-running code reasoning calls risk premature cancellation.",
    evidence: "env contract: HERMES_MCP_TIMEOUT_MS baseline=45000 current=30000",
  },
  {
    severity: "medium",
    category: "ui",
    component: "dashboard",
    title: "p95 latency tooltip inconsistent with parity check",
    description:
      "Observability panel rounds p95 to integer while parity gate compares raw floats. Displays 128ms while gate evaluates 127.6ms.",
    evidence: "parity_report.json: p95=127.6ms vs UI render 128ms",
  },
  {
    severity: "low",
    category: "infra",
    component: "worker",
    title: "worker-07 idle for more than 24 hours",
    description:
      "Queue runner worker-07 has not claimed a job in 26h. Likely stuck heartbeat lease; recommend draining and re-registering.",
    evidence: "jobs: last_claim=26h ago, heartbeat=alive, lease=orphaned",
  },
  {
    severity: "low",
    category: "dependency",
    component: "opencode",
    title: "Duplicated transitive versions of semver",
    description:
      "Three disjoint semver ranges (7.5.2, 7.7.1, 6.3.1) inflate the SBOM and image size by ~11MB.",
    evidence: "sbom.cyclonedx.json: pkg:npm/semver appears 3×",
  },
  {
    severity: "low",
    category: "security",
    component: "openclaw",
    title: "SBOM entry without license: internal agent-shell",
    description:
      "CycloneDX SBOM lacks a declared license for pkg:internal/agent-shell, blocking automated license compliance gate.",
    evidence: "sbom: components[14].licenses = [] → license gate skipped",
  },
  {
    severity: "info",
    category: "config",
    component: "gateway",
    title: "Queue depth alert threshold not codified",
    description:
      "Operational threshold (queue > 40) exists only in runbook prose. Recommend codifying as infra/alerting/queue_depth.yaml.",
    evidence: "RUNBOOK.md §4.2 mentions threshold; no artifact found under /infra",
  },
  {
    severity: "info",
    category: "ui",
    component: "knowledge",
    title: "Knowledge search lacks empty-state illustration",
    description:
      "Empty corpus query renders a bare panel. Reconstruction README flags this as a UX debt item.",
    evidence: "visual diff: knowledge/search.empty — baseline asset missing",
  },
];

/* ------------------------------------------------------------------ */
/* Functional parity baseline                                            */
/* ------------------------------------------------------------------ */
export const PARITY_CHECK_BASES = [
  { key: "golden_tests", label: "golden tests", baselineValue: "214/214", currentValue: "214/214" },
  { key: "service_inventory", label: "service inventory", baselineValue: "9 services", currentValue: "9 services" },
  { key: "env_contract", label: "env contract", baselineValue: "42 vars", currentValue: "42 vars" },
  { key: "port_map", label: "port map", baselineValue: "7 bindings", currentValue: "7 bindings" },
  { key: "db_schema", label: "DB schema & migration state", baselineValue: "12 indexes", currentValue: "10 indexes" },
  { key: "ui_critical_paths", label: "UI critical paths", baselineValue: "18 flows", currentValue: "18 flows" },
  { key: "p95_latency", label: "p95 latency threshold", baselineValue: "≤ 150ms", currentValue: "127.6ms" },
] as const;

export const PARITY_GATES = [
  { key: "ci_matrix", label: "CI matrix green", status: "passed" },
  { key: "sbom_generated", label: "SBOM generated", status: "passed" },
  { key: "secrets_scan", label: "Secrets scan", status: "warning" },
  { key: "rollback_plan", label: "Rollback plan attached", status: "passed" },
] as const;

/* ------------------------------------------------------------------ */
/* Synthetic operational events for the live feed                        */
/* ------------------------------------------------------------------ */
export const EVENT_POOL: Array<{ type: string; severity: "info" | "warning" | "success"; source: string; message: string }> = [
  { type: "system.health", severity: "success", source: "gateway", message: "Health probe ok across 9 components (p95 126ms)" },
  { type: "worker.claim", severity: "info", source: "worker-04", message: "Job claim: artifact.package for audit trail" },
  { type: "telemetry.sample", severity: "info", source: "otel-collector", message: "Trace sample exported: 512 spans, baggage 11 keys" },
  { type: "session.open", severity: "info", source: "openclaw", message: "New agent shell session ws-8842 (mcp tools: 26)" },
  { type: "policy.check", severity: "success", source: "hermes", message: "Policy gate passed: read-only invariant held (0 mutations)" },
  { type: "queue.depth", severity: "warning", source: "worker", message: "Queue depth 23 approaching threshold 40" },
  { type: "auth.deny", severity: "warning", source: "gateway", message: "Auth denied: invalid token from 10.0.4.17 (rate-limited)" },
  { type: "memory.compact", severity: "info", source: "memory", message: "Vector store compaction complete: 1.2M vectors, reclaimed 214MB" },
  { type: "knowledge.index", severity: "success", source: "knowledge", message: "Indexed 12 reconstructed artifacts into corpus" },
  { type: "deploy.note", severity: "info", source: "dashboard", message: "Monorepo skeleton export queued (human-in-the-loop approval)" },
];

/* ------------------------------------------------------------------ */
/* Reconstructed artifact content builders                               */
/* ------------------------------------------------------------------ */
export function buildReadme(auditName: string, date: string): string {
  return `# AI Agent OS — Reconstructed System Overview

> Generated by **AI System Auditor** · audit \`${auditName}\` · ${date}
> Independence guarantee: auditor runs read-only, outside the runtime path.

## 1. Executive summary

The runtime consists of **9 components** orchestrated by **Hermes**. All traffic
ingresses through the **Gateway** (REST + WS). The auditor observed the system
without mutation, reconstructed its topology, and exported machine-readable
inventories alongside this document.

| Layer        | Components                              | State     |
| ------------ | --------------------------------------- | --------- |
| Ingress      | Gateway (API/Auth/MCP bridge)           | healthy   |
| Orchestrator | Hermes                                  | healthy   |
| Agents       | OpenClaw, OpenCode, Worker              | healthy   |
| State        | Memory (vector store), Knowledge (docs) | 1 drift   |
| Surface      | Dashboard (this control plane)          | healthy   |
| Audit        | AI System Auditor                       | read-only |

## 2. Runtime invariants (verified)

- Hermes is the only component allowed to dispatch cross-agent tasks.
- Auditor connects over **read-only** credentials: SELECT on DB, docker inspect,
  GitHub read-only token. Zero mutations during the audit window.
- Human-in-the-loop approval is required before any package is pushed upstream.

## 3. Monorepo skeleton

\`\`\`text
/agents/openclaw     — UX / agent shell
/agents/hermes       — orchestrator core
/agents/opencode     — code & tool reasoner
/audit-scripts       — discovery + normalization pipelines
/frontend            — dashboard (this UI)
/infra               — docker, alerting, policies
/docs                — architecture decisions, runbooks
/.github/workflows   — CI matrix incl. parity gate
\`\`\`

## 4. How to reproduce

1. Run \`audit run\` from the Audit Center to re-execute the 3-stage pipeline.
2. Normalized JSON lands under \`/audit/normalized/\`.
3. Reconstructed artifacts (this file, SBOM, diagrams, runbook) land under
   \`/audit/recon/\` and are indexed into the Knowledge corpus.

## 5. Known debt (from findings)

- 2 missing indexes on telemetry hot paths (dashboard polling).
- MCP tool timeout drift: 30s runtime vs 45s baseline contract.
- SBOM missing license for internal agent-shell package.
`;
}

export function buildSbom(auditName: string): string {
  return JSON.stringify(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      serialNumber: `urn:uuid:7f2c1a8e-${auditName}`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: [{ vendor: "AI Agent OS", name: "auditor-sbom-export", version: "0.3.1" }],
        component: { type: "application", name: "ai-agent-os", version: "1.0.0" },
      },
      components: [
        { type: "library", "bom-ref": "pkg:npm/next@16.2.6", name: "next", version: "16.2.6", licenses: [{ license: { id: "MIT" } }] },
        { type: "library", "bom-ref": "pkg:npm/react@19.2.6", name: "react", version: "19.2.6", licenses: [{ license: { id: "MIT" } }] },
        { type: "library", "bom-ref": "pkg:npm/@xyflow/react@12", name: "@xyflow/react", version: "12.3.6", licenses: [{ license: { id: "MIT" } }] },
        { type: "library", "bom-ref": "pkg:npm/drizzle-orm@0.45.2", name: "drizzle-orm", version: "0.45.2", licenses: [{ license: { id: "Apache-2.0" } }] },
        { type: "library", "bom-ref": "pkg:npm/pg@8.20.0", name: "pg", version: "8.20.0", licenses: [{ license: { id: "MIT" } }] },
        { type: "library", "bom-ref": "pkg:npm/recharts@3", name: "recharts", version: "3.2.1", licenses: [{ license: { id: "MIT" } }] },
        { type: "library", "bom-ref": "pkg:npm/zustand@5", name: "zustand", version: "5.0.6", licenses: [{ license: { id: "MIT" } }] },
        { type: "library", "bom-ref": "pkg:npm/@tanstack/react-query@5", name: "@tanstack/react-query", version: "5.62.0", licenses: [{ license: { id: "MIT" } }] },
        { type: "library", "bom-ref": "pkg:npm/framer-motion@12", name: "framer-motion", version: "12.4.0", licenses: [{ license: { id: "MIT" } }] },
        { type: "library", "bom-ref": "pkg:npm/tailwindcss@4.1.17", name: "tailwindcss", version: "4.1.17", licenses: [{ license: { id: "MIT" } }] },
        { type: "container", "bom-ref": "pkg:docker/node@20.11-alpine", name: "node", version: "20.11-alpine", licenses: [] },
        { type: "container", "bom-ref": "pkg:docker/postgres@16.4", name: "postgres", version: "16.4", licenses: [{ license: { id: "PostgreSQL" } }] },
        { type: "application", "bom-ref": "pkg:internal/hermes@1.4.2", name: "hermes", version: "1.4.2", licenses: [{ license: { id: "Proprietary" } }] },
        { type: "application", "bom-ref": "pkg:internal/agent-shell@0.9.4", name: "agent-shell", version: "0.9.4", licenses: [] },
        { type: "application", "bom-ref": "pkg:internal/auditor@0.3.1", name: "ai-system-auditor", version: "0.3.1", licenses: [{ license: { id: "Proprietary" } }] },
      ],
    },
    null,
    2,
  );
}

export function buildRunbook(): string {
  return `# RUNBOOK — AI Agent OS Incident & Recovery

_Last reconciled by AI System Auditor · scope: production_

## 1. Golden signals

| Signal          | Healthy        | Action when breached                |
| --------------- | -------------- | ----------------------------------- |
| p95 latency     | <= 150 ms      | §3.1 latency triage                 |
| Queue depth     | < 40 jobs      | §3.2 worker scale-out               |
| Error rate      | < 0.5 %        | §3.3 auth/ingress inspection        |
| Auditor parity  | score >= 95    | §4 parity gate failure              |

## 2. Access map (read-only by default)

- Grafana-equivalent: Observability page of the dashboard.
- Raw evidence: Knowledge page -> audit artifacts.
- Approvals: all mutating action requires human-in-the-loop approval; the
  dashboard never mutates production on its own.

## 3. Incident playbooks

### 3.1 Latency triage
1. Obs page -> latency chart; correlate with queue depth panel.
2. If queue > 30 and p95 rising -> drain worker-07 (known idle lease bug).
3. Verify memory vector store p99 (target < 50 ms).

### 3.2 Worker scale-out
1. dashboard -> Observability -> Job queue.
2. Approve \`worker scale +2\` (human approval token required).
3. Confirm parity gate stays green; auditor verifies after 5 min.

### 3.3 Auth anomalies
1. Check gateway auth.denied counter (events feed).
2. Rate limits engage automatically at 10 denials/min/IP.

## 4. Parity gate failure

1. Open Parity Center -> diff the failing check (baseline vs current).
2. Each check links to its evidence artifact under Knowledge.
3. Rollback: deploy the packaged artifact from the previous green audit
   (see Package stage in the lifecycle pipeline).

## 5. Recovery from scratch

The reconstruction bundle (README + SBOM + mermaid + this runbook) is
sufficient to rebuild the system on a clean VM. Verified monthly by the
auditor's "Build on clean VM" stage.
`;
}

export function buildArchitectureMmd(): string {
  return `flowchart LR
  subgraph Agents
    OC[OpenClaw<br/>UX / Agent Shell]
    OCD[OpenCode<br/>Code & Tool Reasoner]
    GW[Gateway<br/>API / Auth / MCP]
    WK[Worker<br/>Jobs / Queue]
    MEM[Memory<br/>Vector Store]
    KN[Knowledge<br/>Docs / Corpus]
    DB[Dashboard<br/>Control Plane]
  end
  H((Hermes<br/>Orchestrator & Coordinator))
  AUD[AI System Auditor<br/>read-only]
  OC --> H
  OCD --> H
  GW --> H
  WK --> H
  MEM --> H
  KN --> H
  DB --> H
  AUD -. READ-ONLY .-> H
  AUD -. artifacts .-> DB
`;
}

export function buildDependencyMmd(): string {
  return `flowchart TD
  FE[frontend<br/>next 16.2.6] --> XY[@xyflow/react 12.3.6]
  FE --> RC[recharts 3.2.1]
  FE --> RQ[@tanstack/react-query 5.62.0]
  FE --> ZS[zustand 5.0.6]
  FE --> FM[framer-motion 12.4.0]
  API[gateway] --> DZ[drizzle-orm 0.45.2]
  DZ --> PG[(postgres 16.4)]
  API --> PGX[pg 8.20.0]
  WRK[worker fleet] --> PG
  AUD[ai-system-auditor 0.3.1] -. SELECT only .-> PG
  AUD -. inspect only .-> DKR[docker engine]
`;
}

export function buildParityReportJson(score: number, checks: unknown[]): string {
  return JSON.stringify(
    {
      report: "parity_report.json",
      generated_by: "ai-system-auditor",
      methodology:
        "Behavioral parity measured across endpoints, service inventory, env contract, port map, DB schema state and UI critical paths — not source code diff.",
      overall_score: score,
      overall_status: score >= 95 ? "passed" : score >= 80 ? "warning" : "failed",
      checks,
    },
    null,
    2,
  );
}

export function buildServiceCatalog(): string {
  return JSON.stringify(
    {
      report: "service_catalog.json",
      stage: "2-normalization",
      services: [
        { id: "gateway", port: 8080, proto: "http/ws", health: "/api/health", exposes: ["rest", "websocket"] },
        { id: "hermes", port: 9100, proto: "grpc", health: "grpc.health.v1", exposes: ["task-dispatch"] },
        { id: "openclaw", port: 5111, proto: "ws", health: "/healthz", exposes: ["agent-shell"] },
        { id: "opencode", port: 5222, proto: "http", health: "/healthz", exposes: ["tool-calls"] },
        { id: "worker", port: 5333, proto: "amqp", health: "queue://jobs", exposes: ["job-runner"] },
        { id: "memory", port: 6333, proto: "grpc", health: "grpc.health.v1", exposes: ["vector-store"] },
        { id: "knowledge", port: 6444, proto: "http", health: "/healthz", exposes: ["search", "corpus"] },
        { id: "dashboard", port: 3000, proto: "http", health: "/api/health", exposes: ["ui", "sse"] },
        { id: "auditor", port: 6555, proto: "http", health: "/healthz", exposes: ["audit-api"], mode: "read-only" },
      ],
    },
    null,
    2,
  );
}

export const ARTIFACT_KIND_META: Record<string, { label: string; tone: string }> = {
  markdown: { label: "DOC", tone: "cyan" },
  sbom: { label: "SBOM", tone: "purple" },
  runbook: { label: "RUNBOOK", tone: "green" },
  mermaid: { label: "GRAPH", tone: "blue" },
  json: { label: "JSON", tone: "amber" },
};
