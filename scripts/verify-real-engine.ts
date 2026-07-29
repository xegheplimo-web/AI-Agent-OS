import "dotenv/config";
/* Harness: runs the REAL auditor engine once and verifies its output. */
process.env.APP_MODE = "production";

async function main() {
  const { db, closeDb } = await import("../src/db");
  const { audits, findings, artifacts, parityReports } = await import("../src/db/schema");
  const { runRealAudit } = await import("../src/services/auditor/engine");
  const { eq, desc } = await import("drizzle-orm");
  const { createHash } = await import("node:crypto");

  const [row] = await db.insert(audits).values({
    name: `AUD-REAL-${Date.now().toString().slice(-6)}`, triggerType: "ci", status: "running",
    stages: [], environment: "local", requestedBy: "verify-harness", startedAt: new Date(),
  }).returning();

  const t0 = Date.now();
  await runRealAudit(row.id);

  const [done] = await db.select().from(audits).where(eq(audits.id, row.id));
  const f = await db.select().from(findings).where(eq(findings.auditId, row.id));
  const a = await db.select().from(artifacts).where(eq(artifacts.auditId, row.id));
  const [p] = await db.select().from(parityReports).orderBy(desc(parityReports.createdAt)).limit(1);

  console.log(`status=${done.status} score=${done.score} elapsed=${Date.now() - t0}ms`);
  console.log(`stages: ${(done.stages ?? []).map((s) => `${s.key}:${s.status}(${s.durationMs}ms)`).join("  ")}`);
  console.log(`findings=${f.length} artifacts=${a.length} parity=${p.score}/${p.overallStatus}\n`);

  console.log("REAL FINDINGS (derived from measurement):");
  f.forEach((x) => console.log(` [${x.severity.padEnd(8)}] ${x.title}\n    ↳ ${x.evidence.slice(0, 95)}`));

  console.log("\nARTIFACTS:");
  let allOk = true;
  a.forEach((x) => {
    const ok = createHash("sha256").update(x.content).digest("hex") === x.sha256;
    if (!ok) allOk = false;
    console.log(` ${ok ? "✓" : "✗"} ${x.path.padEnd(46)} ${String(x.sizeBytes).padStart(7)}B`);
  });

  const sbom = a.find((x) => x.kind === "sbom");
  if (sbom) console.log(`\nSBOM: ${JSON.parse(sbom.content).components.length} components (resolved from node_modules)`);
  const readme = a.find((x) => x.kind === "markdown");
  if (readme) console.log(`README preview:\n${readme.content.split("\n").slice(0, 12).map((l) => "  " + l).join("\n")}`);

  await closeDb();
  if (done.status !== "completed" || !allOk) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
