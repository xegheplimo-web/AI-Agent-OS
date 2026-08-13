import "dotenv/config";
import { createHash } from "node:crypto";

/* ------------------------------------------------------------------ */
/* Demo seed. DEV ONLY — refuses to run against production databases.  */
/* ------------------------------------------------------------------ */

if (process.env.SEED_ALLOW !== "1" && process.env.APP_MODE === "production") {
  throw new Error("Seed is disabled when APP_MODE=production. Set SEED_ALLOW=1 to override.");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function mimeOf(kind: string): string {
  switch (kind) {
    case "sbom":
    case "json":
      return "application/json";
    case "mermaid":
      return "text/vnd.mermaid";
    default:
      return "text/markdown";
  }
}

function formatOf(kind: string): string {
  switch (kind) {
    case "sbom":
    case "json":
      return "json";
    case "mermaid":
      return "mmd";
    default:
      return "md";
  }
}

async function main() {
  const { db } = await import("./index");
  const schema = await import("./schema");
  const data = await import("../lib/audit-data");
  const { hashPassword } = await import("../lib/auth");
  const { computeParityScore } = await import("../lib/parity");
  const { sql } = await import("drizzle-orm");

  console.log("→ truncating tables…");
  await db.execute(
    sql`TRUNCATE TABLE components, audits, findings, parity_reports, telemetry_points, events, jobs, artifacts, settings, users, sessions, approvals, audit_logs RESTART IDENTITY CASCADE`,
  );

  /* ---------------- users ---------------- */
  await db.insert(schema.users).values([
    { username: "admin", displayName: "Alice Nguyễn", role: "administrator", passwordHash: hashPassword("AgentOS#admin") },
    { username: "operator.han", displayName: "Han Tran", role: "operator", passwordHash: hashPassword("AgentOS#ops") },
    { username: "viewer", displayName: "Guest Viewer", role: "viewer", passwordHash: hashPassword("AgentOS#view") },
  ]);
  console.log("✓ 3 users (admin / operator.han / viewer)");

  /* ---------------- components ---------------- */
  await db.insert(schema.components).values(
    data.COMPONENT_SEED.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      group: c.group,
      status: c.status,
      latencyMs: c.latencyMs,
      uptimePct: c.uptimePct,
      version: c.version,
      position: c.position,
      metrics: c.metrics as Record<string, string | number>,
    })),
  );
  console.log(`✓ ${data.COMPONENT_SEED.length} components`);

  /* ---------------- completed audit ---------------- */
  const now = Date.now();
  const auditStart = new Date(now - 1000 * 60 * 42);
  const auditEnd = new Date(auditStart.getTime() + 15900);
  const stageStarts = [0, 4500, 9700];

  const stages = data.AUDIT_STAGE_DEFS.map((d, i) => ({
    key: d.key,
    label: d.label,
    status: "done" as const,
    startedAt: new Date(auditStart.getTime() + stageStarts[i]).toISOString(),
    durationMs: data.STAGE_DURATION_MS[i],
    artifacts: d.artifacts.slice(),
    detail: d.detail,
  }));

  const auditId = crypto.randomUUID();
  await db.insert(schema.audits).values({
    id: auditId,
    name: "AUD-20260107-014",
    triggerType: "manual",
    status: "completed",
    score: 94,
    stages,
    artifactNames: data.AUDIT_STAGE_DEFS.flatMap((d) => d.artifacts.slice()),
    findingsCount: { critical: 1, high: 2, medium: 3, low: 2, info: 1 },
    environment: "production",
    requestedBy: "admin",
    startedAt: auditStart,
    finishedAt: auditEnd,
  });

  const picked = data.FINDING_POOL.slice(0, 9);
  for (const f of picked) {
    await db.insert(schema.findings).values({
      auditId,
      severity: f.severity,
      category: f.category,
      component: f.component,
      title: f.title,
      description: f.description,
      evidence: f.evidence,
      status: f.severity === "info" ? "acknowledged" : "open",
      fingerprint: sha256(`${f.component}|${f.category}|${f.title}`).slice(0, 32),
      createdAt: new Date(auditEnd.getTime() + 2000),
    });
  }
  console.log(`✓ 1 audit + ${picked.length} findings`);

  /* ---------------- parity reports ---------------- */
  const checks = data.PARITY_CHECK_BASES.map((c) => {
    if (c.key === "db_schema") return { ...c, status: "warning" as const, difference: "2 missing indexes" };
    if (c.key === "env_contract")
      return { ...c, status: "warning" as const, difference: "HERMES_MCP_TIMEOUT_MS 30s vs 45s" };
    return { ...c, status: "passed" as const };
  });
  const scored = computeParityScore(checks);
  await db.insert(schema.parityReports).values({
    overallStatus: scored.overallStatus,
    score: scored.score,
    checks,
    gates: data.PARITY_GATES.map((g) => ({ ...g })),
    createdAt: new Date(auditEnd.getTime() + 3000),
  });
  const greenChecks = data.PARITY_CHECK_BASES.map((c) => ({ ...c, status: "passed" as const }));
  await db.insert(schema.parityReports).values({
    overallStatus: "passed",
    score: 100,
    checks: greenChecks,
    gates: data.PARITY_GATES.map((g) => ({ ...g, status: "passed" })),
    createdAt: new Date(now - 1000 * 60 * 60 * 26),
  });
  console.log("✓ 2 parity reports");

  /* ---------------- telemetry history (2.5h, 5-min buckets) ---------------- */
  const metrics: Array<[string, number, number]> = [
    ["latency_p95", 128, 12],
    ["latency_p50", 54, 6],
    ["throughput", 1284, 110],
    ["error_rate", 0.22, 0.14],
    ["queue_depth", 21, 6],
  ];
  const points: Array<{ metric: string; value: number; ts: Date; source: string }> = [];
  for (let i = 30; i >= 0; i--) {
    const ts = new Date(now - i * 5 * 60 * 1000);
    for (const [metric, base, noise] of metrics) {
      const wave = Math.sin((30 - i) / 4.5) * noise * 0.7;
      const jitter = Math.sin(i * 12.9898) * 43758.5453;
      const r = (jitter - Math.floor(jitter) - 0.5) * noise;
      const v =
        metric === "error_rate" || metric.startsWith("latency")
          ? Math.round((base + wave + r) * 10) / 10
          : Math.round(base + wave + r);
      /* source="manual" so the telemetry summary does NOT label seed data
         as "otlp" or "synthetic". "manual" is honest: this was inserted by
         the seed script, not a real collector or the demo sampler. */
      points.push({ metric, value: Math.max(metric === "error_rate" ? 0.02 : 1, v), ts, source: "manual" });
    }
  }
  await db.insert(schema.telemetryPoints).values(points);
  console.log(`✓ ${points.length} telemetry points`);

  /* ---------------- events ---------------- */
  const eventsSeed = [
    { type: "audit.completed", severity: "success", source: "auditor", message: "AUD-20260107-014 completed — score 94, 9 findings, parity 92%", at: 41 },
    { type: "parity.gate", severity: "warning", source: "auditor", message: "Parity gate warning: 5/7 checks green — db_schema drift detected", at: 40 },
    { type: "finding.created", severity: "error", source: "auditor", message: "Critical finding: exposed credential material in repository history", at: 39 },
    { type: "approval.requested", severity: "warning", source: "auditor-service", message: "Yêu cầu phê duyệt: Package & push reconstruction bundle (read-only source)", at: 38 },
    ...data.EVENT_POOL.slice(0, 10).map((e, i) => ({ ...e, at: 3 + i * 4 })),
  ];
  for (const e of eventsSeed) {
    await db.insert(schema.events).values({
      type: e.type,
      severity: e.severity,
      source: e.source,
      message: e.message,
      createdAt: new Date(now - e.at * 60 * 1000),
    });
  }
  console.log(`✓ ${eventsSeed.length} events`);

  /* ---------------- jobs ---------------- */
  const jobsSeed = [
    { type: "audit.run", status: "completed", target: `audit:${"AUD-20260107-014"}`, progress: 100, worker: "worker-02", atMin: 42, attempt: 1, auditId },
    { type: "sbom.export", status: "completed", target: "audit/recon/sbom.cyclonedx.json", progress: 100, worker: "worker-05", atMin: 40, attempt: 1 },
    { type: "parity.gate", status: "completed", target: "ci/parity-gate", progress: 100, worker: "worker-01", atMin: 38, attempt: 2 },
    { type: "artifact.package", status: "queued", target: "audit/recon/bundle.tar.zst", progress: 0, worker: null, atMin: 2, attempt: 0 },
    { type: "knowledge.reindex", status: "completed", target: "corpus/full", progress: 100, worker: "worker-09", atMin: 90, attempt: 1 },
  ];
  for (const j of jobsSeed) {
    await db.insert(schema.jobs).values({
      type: j.type,
      status: j.status,
      target: j.target,
      progress: j.progress,
      attempt: j.attempt,
      worker: j.worker,
      auditId: "auditId" in j ? (j.auditId as string) : null,
      startedAt: j.status === "completed" ? new Date(now - j.atMin * 60 * 1000) : null,
      finishedAt: j.status === "completed" ? new Date(now - (j.atMin - 5) * 60 * 1000) : null,
      createdAt: new Date(now - j.atMin * 60 * 1000),
      updatedAt: new Date(now - j.atMin * 60 * 1000),
    });
  }
  console.log(`✓ ${jobsSeed.length} jobs`);

  /* ---------------- approvals ---------------- */
  await db.insert(schema.approvals).values([
    {
      actionType: "artifact.package",
      targetType: "audit",
      targetId: auditId,
      title: "Package reconstruction bundle của AUD-20260107-014 (local artifact)",
      status: "pending",
      requestedBy: "auditor-service",
      requestedAt: new Date(now - 38 * 60 * 1000),
      payload: { auditId, target: "audit/recon/bundle.tar.zst" },
    },
    {
      actionType: "audit.run",
      targetType: "audit",
      targetId: auditId,
      title: "Chạy audit toàn hệ thống trên PRODUCTION (AUD-20260107-014)",
      status: "approved",
      requestedBy: "operator.han",
      requestedAt: new Date(now - 48 * 60 * 1000),
      decidedBy: "admin",
      decidedAt: new Date(now - 44 * 60 * 1000),
      reason: "Cửa sổ bảo trì đã được xác nhận",
      payload: { environment: "production" },
    },
  ]);
  console.log("✓ 2 approvals");

  /* ---------------- artifacts (with checksums) ---------------- */
  const artifactsSeed = [
    { kind: "markdown", title: "README — Reconstructed System Overview", path: "/audit/recon/README.md", content: data.buildReadme("AUD-20260107-014", new Date(auditEnd).toUTCString()), tags: ["audit", "reconstruction", "readme"] },
    { kind: "sbom", title: "SBOM — CycloneDX 1.6", path: "/audit/recon/sbom.cyclonedx.json", content: data.buildSbom("aud-20260107-014"), tags: ["sbom", "compliance", "supply-chain"] },
    { kind: "runbook", title: "RUNBOOK — Incident & Recovery", path: "/audit/recon/RUNBOOK.md", content: data.buildRunbook(), tags: ["runbook", "ops", "recovery"] },
    { kind: "mermaid", title: "Architecture Graph — Mermaid", path: "/audit/recon/architecture.mmd", content: data.buildArchitectureMmd(), tags: ["diagram", "architecture"] },
    { kind: "mermaid", title: "Dependency Graph — Mermaid", path: "/audit/recon/dependency_graph.mmd", content: data.buildDependencyMmd(), tags: ["diagram", "dependencies"] },
    { kind: "json", title: "parity_report.json", path: "/audit/recon/parity_report.json", content: data.buildParityReportJson(scored.score, checks), tags: ["parity", "gate"] },
    { kind: "json", title: "service_catalog.json", path: "/audit/normalized/service_catalog.json", content: data.buildServiceCatalog(), tags: ["inventory", "normalization"] },
  ];
  for (const a of artifactsSeed) {
    const size = Buffer.byteLength(a.content, "utf-8");
    await db.insert(schema.artifacts).values({
      auditId,
      kind: a.kind,
      format: formatOf(a.kind),
      title: a.title,
      path: a.path,
      storageProvider: "db",
      storageKey: a.path,
      mimeType: mimeOf(a.kind),
      sizeBytes: size,
      sizeKb: Math.round((size / 1024) * 10) / 10,
      sha256: sha256(a.content),
      schemaVersion: "1.0",
      generator: "ai-system-auditor",
      generatorVersion: "0.3.1",
      content: a.content,
      tags: a.tags,
      metadata: { audit: "AUD-20260107-014", stage: a.path.includes("normalized") ? "normalization" : "reconstruction" },
      updatedAt: new Date(auditEnd.getTime() + 4000),
    });
  }
  console.log(`✓ ${artifactsSeed.length} artifacts (sha256-verified)`);

  /* ---------------- settings ---------------- */
  await db.insert(schema.settings).values([
    { key: "production_rules", value: data.PRODUCTION_RULES_DEFAULT },
    { key: "workspace", value: data.WORKSPACE_DEFAULT },
    { key: "notifications", value: data.NOTIFICATIONS_DEFAULT },
  ]);

  /* ---------------- audit log trail ---------------- */
  const logs = [
    { actorType: "user", actorId: "operator.han", action: "audit.request", resourceType: "audit", resourceId: auditId, result: "success", at: 48 },
    { actorType: "user", actorId: "admin", action: "approval.approved", resourceType: "approval", resourceId: null, result: "success", at: 44 },
    { actorType: "system", actorId: "auditor-service", action: "audit.completed", resourceType: "audit", resourceId: auditId, result: "success", at: 41 },
    { actorType: "user", actorId: "operator.han", action: "finding.update", resourceType: "finding", resourceId: "9", result: "success", at: 20 },
  ];
  for (const l of logs) {
    await db.insert(schema.auditLogs).values({
      actorType: l.actorType,
      actorId: l.actorId,
      action: l.action,
      resourceType: l.resourceType,
      resourceId: l.resourceId,
      result: l.result,
      createdAt: new Date(now - l.at * 60 * 1000),
    });
  }
  console.log(`✓ settings + ${logs.length} audit log rows`);
  console.log("\nSeed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
