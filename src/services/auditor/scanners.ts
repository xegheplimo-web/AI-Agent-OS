import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { getDb } from "@/db";
import { startScan, type RawFinding, type ScanResult } from "@/services/auditor/types";
import type { AuditTarget, Scope } from "@/services/auditor/target";
import { scopeEnabled, databaseScopeEnabled } from "@/services/auditor/target";

/* ------------------------------------------------------------------ */
/* REAL discovery scanners.                                            */
/*                                                                     */
/* Read-only by construction:                                          */
/*  - filesystem: readdir/readFile only                                 */
/*  - database:   SELECT against information_schema / pg_indexes only  */
/*  - packages:   parses package.json + installed node_modules metadata */
/* No process spawning, no writes, no mutations. Matches the           */
/* "DB: SELECT only / inspect only / no mutate on production" rules.   */
/* ------------------------------------------------------------------ */

/* Legacy helpers kept for verify-executors.ts and other callers that
   haven't been migrated to the target-aware API yet. */
const LEGACY_ROOT = path.resolve(process.env.AUDIT_TARGET_ROOT ?? process.cwd());

/** True when the target really looks like a source repository. */
export function targetLooksValid(): { valid: boolean; reason?: string } {
  if (!existsSync(LEGACY_ROOT)) return { valid: false, reason: `AUDIT_TARGET_ROOT does not exist: ${LEGACY_ROOT}` };
  if (!existsSync(path.join(LEGACY_ROOT, "package.json"))) {
    return { valid: false, reason: `no package.json under ${LEGACY_ROOT} — auditing a packaged bundle instead of a repository?` };
  }
  return { valid: true };
}

export function auditTargetRoot(): string {
  return LEGACY_ROOT;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  "target",
  "out",
  "data",
]);

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".rs", ".py", ".sql"]);

interface FileEntry {
  rel: string;
  ext: string;
  bytes: number;
  lines: number;
}

async function walk(dir: string, acc: FileEntry[], depth = 0, root?: string): Promise<void> {
  const basePath = root ?? LEGACY_ROOT;
  if (depth > 8) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".github" && e.name !== ".env.example") continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, acc, depth + 1, basePath);
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      try {
        const s = await stat(full);
        if (s.size > 2_000_000) continue;
        let lines = 0;
        if (CODE_EXT.has(ext) || ext === ".json" || ext === ".md" || ext === ".yml") {
          const content = await readFile(full, "utf-8");
          lines = content.split("\n").length;
        }
        acc.push({ rel: path.relative(basePath, full), ext, bytes: s.size, lines });
      } catch {
        /* unreadable file — skipped, reported as warning by caller */
      }
    }
  }
}

/* ---------------- 1. filesystem + repo inventory ---------------- */
export async function scanFilesystem(target?: AuditTarget): Promise<ScanResult> {
  const scan = startScan("filesystem-inventory");
  try {
    const root = target?.root ?? LEGACY_ROOT;
    if (target && !target.rootValid) return scan.fail(target.rootInvalidReason ?? `invalid target root: ${root}`);
    if (!target) {
      const check = targetLooksValid();
      if (!check.valid) return scan.fail(check.reason);
    }

    const files: FileEntry[] = [];
    await walk(root, files, 0, root);

    const byExt: Record<string, { files: number; lines: number; bytes: number }> = {};
    for (const f of files) {
      const key = f.ext || "(none)";
      byExt[key] ??= { files: 0, lines: 0, bytes: 0 };
      byExt[key].files += 1;
      byExt[key].lines += f.lines;
      byExt[key].bytes += f.bytes;
    }

    const topLevel = (await readdir(root, { withFileTypes: true }))
      .filter((e) => !e.name.startsWith(".") || e.name === ".github")
      .filter((e) => !SKIP_DIRS.has(e.name))
      .map((e) => `${e.isDirectory() ? "dir " : "file"} /${e.name}`)
      .sort();

    const warnings: string[] = [];
    const configFiles = [
      "package.json",
      "tsconfig.json",
      "next.config.ts",
      "drizzle.config.json",
      "docker-compose.yml",
      "Dockerfile",
      ".env.example",
      "README.md",
    ].filter((f) => existsSync(path.join(root, f)));

    for (const required of ["README.md", ".env.example", "Dockerfile", "docker-compose.yml"]) {
      if (!configFiles.includes(required)) warnings.push(`missing ${required}`);
    }
    if (!existsSync(path.join(root, "package-lock.json"))) {
      warnings.push("package-lock.json missing — npm ci will fail in CI/Docker");
    }

    const totalLines = files.reduce((a, f) => a + f.lines, 0);
    return scan.ok(
      {
        targetRoot: root,
        totalFiles: files.length,
        totalLines,
        totalBytes: files.reduce((a, f) => a + f.bytes, 0),
        byExtension: byExt,
        topLevel,
        configFiles,
        lockFilePresent: existsSync(path.join(root, "package-lock.json")),
        largestFiles: [...files].sort((a, b) => b.lines - a.lines).slice(0, 8).map((f) => ({ path: f.rel, lines: f.lines })),
      },
      ["raw/host_inventory.json", "raw/repo_inventory.json"],
      warnings,
    );
  } catch (err) {
    return scan.fail(err);
  }
}

/* ---------------- 2. package / SBOM inventory ---------------- */
export async function scanPackages(target?: AuditTarget): Promise<ScanResult> {
  const scan = startScan("package-inventory");
  try {
    if (target && !target.rootValid) return scan.fail(target.rootInvalidReason ?? `invalid target root`);
    const root = target?.root ?? LEGACY_ROOT;
    const pkgRaw = await readFile(path.join(root, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const components: Array<{ name: string; version: string; license: string; type: string }> = [];
    const warnings: string[] = [];

    for (const [name, range] of Object.entries(declared)) {
      const modPath = path.join(root, "node_modules", name, "package.json");
      let version = range;
      let license = "UNKNOWN";
      try {
        const meta = JSON.parse(await readFile(modPath, "utf-8")) as {
          version?: string;
          license?: string | { type?: string };
          licenses?: Array<{ type?: string }>;
        };
        version = meta.version ?? range;
        if (typeof meta.license === "string") license = meta.license;
        else if (meta.license?.type) license = meta.license.type;
        else if (meta.licenses?.[0]?.type) license = meta.licenses[0].type;
      } catch {
        warnings.push(`${name} declared but not installed`);
      }
      if (license === "UNKNOWN") warnings.push(`${name}@${version} has no declared license`);
      components.push({
        name,
        version,
        license,
        type: pkg.dependencies?.[name] ? "runtime" : "development",
      });
    }

    /* ---- transitive dependencies: walk node_modules for installed pkgs ---- */
    const seen = new Set(components.map((c) => c.name));
    const transitiveComponents: typeof components = [];
    const topModulesDir = path.join(root, "node_modules");
    try {
      const walkScopes = async (base: string) => {
        const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          if (e.name.startsWith(".")) continue;
          if (e.name.startsWith("@")) {
            const scopeEntries = await readdir(path.join(base, e.name), { withFileTypes: true }).catch(() => []);
            for (const se of scopeEntries) {
              if (!se.isDirectory()) continue;
              const scoped = `${e.name}/${se.name}`;
              if (seen.has(scoped)) continue;
              seen.add(scoped);
              const pkgPath = path.join(base, e.name, se.name, "package.json");
              try {
                const m = JSON.parse(await readFile(pkgPath, "utf-8")) as { name?: string; version?: string; license?: string | { type?: string } };
                let lic = "UNKNOWN";
                if (typeof m.license === "string") lic = m.license;
                else if (m.license?.type) lic = m.license.type;
                transitiveComponents.push({ name: m.name ?? scoped, version: m.version ?? "0.0.0", license: lic, type: "transitive" });
              } catch { /* not a package */ }
            }
          } else {
            if (seen.has(e.name)) continue;
            seen.add(e.name);
            const pkgPath = path.join(base, e.name, "package.json");
            try {
              const m = JSON.parse(await readFile(pkgPath, "utf-8")) as { name?: string; version?: string; license?: string | { type?: string } };
              let lic = "UNKNOWN";
              if (typeof m.license === "string") lic = m.license;
              else if (m.license?.type) lic = m.license.type;
              transitiveComponents.push({ name: m.name ?? e.name, version: m.version ?? "0.0.0", license: lic, type: "transitive" });
            } catch { /* not a package */ }
          }
        }
      };
      await walkScopes(topModulesDir);
    } catch {
      warnings.push("could not walk node_modules for transitive dependencies");
    }

    const allComponents = [...components, ...transitiveComponents];

    return scan.ok(
      {
        project: pkg.name ?? "unknown",
        directCount: components.length,
        transitiveCount: transitiveComponents.length,
        totalCount: allComponents.length,
        runtimeCount: components.filter((c) => c.type === "runtime").length,
        unlicensed: allComponents.filter((c) => c.license === "UNKNOWN").map((c) => c.name),
        scripts: Object.keys(pkg.scripts ?? {}),
        components: allComponents,
      },
      ["raw/package_inventory.json"],
      warnings.slice(0, 12),
    );
  } catch (err) {
    return scan.fail(err);
  }
}

/* ---------------- 3. secret scan (gitleaks-style rules) ---------------- */
const SECRET_RULES: Array<{ id: string; re: RegExp; severity: RawFinding["severity"] }> = [
  { id: "generic-api-key", re: /(api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i, severity: "critical" },
  { id: "aws-access-key", re: /AKIA[0-9A-Z]{16}/, severity: "critical" },
  { id: "private-key-block", re: /-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY-----/, severity: "critical" },
  { id: "bearer-token", re: /bearer\s+[A-Za-z0-9\-._~+/]{30,}/i, severity: "high" },
  { id: "postgres-url-with-password", re: /postgres(ql)?:\/\/[^:\s]+:[^@\s]{3,}@/i, severity: "high" },
  { id: "hardcoded-password", re: /(password|passwd|secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/i, severity: "medium" },
];

/* Precision filter: a DSN pointing at localhost / a compose service name with
   well-known development credentials is not a leaked secret. Downgrade it to
   informational instead of drowning real findings in false positives — the
   same trick real scanners use with `# nosec` / baseline files, except the
   decision stays visible in the report. */
const LOCAL_HOSTS = /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres|redis|db)[:/]/i;
const DEV_CREDS = /:\/\/(postgres:postgres|agent_os:agent_os|user:pass\w*|root:root)@/i;

/**
 * Never store a discovered secret verbatim.
 *
 * The excerpt travels into findings.evidence, the security_scan artifact and
 * the audit log — writing the raw value there would make the auditor itself
 * a second copy of the leak. We keep only the shape plus a short digest so an
 * operator can still correlate the hit with the source line.
 */
function redact(line: string): string {
  let out = line;
  // DSN credentials: scheme://user:secret@host → scheme://user:***@host
  out = out.replace(/(:\/\/[^:\s/]+:)([^@\s]+)(@)/g, (_m, a, secret: string, c) => `${a}${mask(secret)}${c}`);
  // key = "value" / key: 'value'
  out = out.replace(
    /((?:api[_-]?key|apikey|token|secret|password|passwd|bearer)\s*[:=]\s*['"]?)([^'"\s,;]{6,})(['"]?)/gi,
    (_m, a, secret: string, c) => `${a}${mask(secret)}${c}`,
  );
  // standalone high-entropy blobs (AWS keys, PEM bodies)
  out = out.replace(/AKIA[0-9A-Z]{16}/g, (m) => mask(m));
  out = out.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, "-----BEGIN PRIVATE KEY----- <redacted>");
  return out;
}

function mask(secret: string): string {
  const digest = createHash("sha256").update(secret).digest("hex").slice(0, 8);
  const head = secret.slice(0, 2);
  return `${head}***REDACTED(len=${secret.length},sha256:${digest})`;
}

function refineSeverity(
  ruleId: string,
  line: string,
  severity: RawFinding["severity"],
): { severity: RawFinding["severity"]; note?: string } {
  if (ruleId === "postgres-url-with-password" && LOCAL_HOSTS.test(line) && DEV_CREDS.test(line)) {
    return {
      severity: "info",
      note: "local development DSN (loopback host + well-known dev credentials) — not treated as a leak",
    };
  }
  return { severity };
}

const SECRET_ALLOWLIST = [/\.env\.example$/, /README\.md$/, /scanners\.ts$/, /seed\.ts$/, /tests\//];

export async function scanSecrets(target?: AuditTarget): Promise<ScanResult> {
  const scan = startScan("secret-scan");
  try {
    if (target && !target.rootValid) return scan.fail(target.rootInvalidReason ?? `invalid target root`);
    const root = target?.root ?? LEGACY_ROOT;
    const files: FileEntry[] = [];
    await walk(path.join(root, "src"), files, 0, root);
    const extra = [".env", ".env.local", "docker-compose.yml", "Dockerfile"]
      .map((f) => path.join(root, f))
      .filter((f) => existsSync(f))
      .map((f) => ({ rel: path.relative(root, f), ext: path.extname(f), bytes: 0, lines: 0 }));

    const hits: Array<{
      rule: string;
      file: string;
      line: number;
      severity: RawFinding["severity"];
      excerpt: string;
      note?: string;
    }> = [];
    const allowlisted: string[] = [];

    for (const f of [...files, ...extra]) {
      if (SECRET_ALLOWLIST.some((re) => re.test(f.rel))) {
        allowlisted.push(f.rel);
        continue;
      }
      let content: string;
      try {
        content = await readFile(path.join(root, f.rel), "utf-8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (const rule of SECRET_RULES) {
        for (let i = 0; i < lines.length; i++) {
          if (rule.re.test(lines[i])) {
            const refined = refineSeverity(rule.id, lines[i], rule.severity);
            hits.push({
              rule: rule.id,
              file: f.rel,
              line: i + 1,
              severity: refined.severity,
              /* redacted before it ever reaches the database */
              excerpt: redact(lines[i].trim()).slice(0, 140),
              ...(refined.note ? { note: refined.note } : {}),
            });
            break; // one hit per rule per file keeps the report readable
          }
        }
      }
    }

    const actionable = hits.filter((h) => h.severity !== "info");
    return scan.ok(
      {
        rulesEvaluated: SECRET_RULES.length,
        filesScanned: files.length + extra.length,
        allowlisted: allowlisted.length,
        actionable: actionable.length,
        downgraded: hits.length - actionable.length,
        hits,
      },
      ["raw/security_scan.json"],
      actionable.length ? [`${actionable.length} actionable secret pattern(s) matched`] : [],
    );
  } catch (err) {
    return scan.fail(err);
  }
}

/* ---------------- 4. database schema (SELECT-only) ---------------- */
export async function scanDatabase(target?: AuditTarget): Promise<ScanResult> {
  const scan = startScan("database-inventory");
  try {
    /* Fail-closed: if no target DB URL is configured, SKIP the DB scanner
       entirely — do NOT fall back to the control plane's own DATABASE_URL.
       Scanning the auditor's own DB would produce a false-green (the
       auditor's DB is always healthy because the auditor is running).
       The scanner returns a "skipped" result with a clear reason so the
       report shows "DB not configured" instead of misleading green. */
    const targetDbUrl = target?.databaseUrl ?? null;
    if (target && !databaseScopeEnabled(target)) {
      return scan.ok(
        {
          targetDatabase: null,
          skipped: true,
          reason: "no TARGET_DATABASE_URL configured for this environment — DB scanner skipped (fail-closed, not scanning control plane's own DB)",
          tableCount: 0,
          tables: [],
          indexCount: 0,
          indexes: [],
          missingIndexes: [],
        },
        ["raw/database_inventory.json"],
        ["DB scanner skipped: no target database configured for this environment"],
      );
    }
    if (!target && !process.env.TARGET_DATABASE_URL) {
      /* Legacy call path (no target) — also fail-closed, don't use control plane DB */
      return scan.ok(
        {
          targetDatabase: null,
          skipped: true,
          reason: "no TARGET_DATABASE_URL configured — DB scanner skipped (fail-closed)",
          tableCount: 0,
          tables: [],
          indexCount: 0,
          indexes: [],
          missingIndexes: [],
        },
        ["raw/database_inventory.json"],
        ["DB scanner skipped: no target database configured"],
      );
    }

    const dbUrl = targetDbUrl ?? process.env.TARGET_DATABASE_URL!;
    const pool = new Pool({
      connectionString: dbUrl,
      max: 2,
      connectionTimeoutMillis: 5_000,
    });

    try {
      const query = async <T>(text: string): Promise<{ rows: T[] }> => {
        return (await pool.query(text)) as unknown as { rows: T[] };
      };

      const tables = await query<{ table_name: string; columns: string }>(
        `select table_name, (select count(*) from information_schema.columns c
           where c.table_name = t.table_name and c.table_schema='public') as columns
         from information_schema.tables t
         where t.table_schema='public' and t.table_type='BASE TABLE'
         order by table_name`,
      );

      const indexes = await query<{ tablename: string; indexname: string; indexdef: string }>(
        `select tablename, indexname, indexdef from pg_indexes
         where schemaname='public' order by tablename, indexname`,
      );

      /* columns that look like hot filter/sort paths but have no index */
      const candidates = await query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
         where table_schema='public'
           and (column_name in ('created_at','ts','audit_id','status','severity','metric','expires_at'))
         order by table_name, column_name`,
      );

      const indexRows = indexes.rows ?? [];
      const missingIndexes = (candidates.rows ?? []).filter(
        (c) =>
          !indexRows.some(
            (i) => i.tablename === c.table_name && i.indexdef.toLowerCase().includes(`(${c.column_name}`),
          ),
      );

      const warnings: string[] = [];
      if (missingIndexes.length) warnings.push(`${missingIndexes.length} hot column(s) without an index`);

      return scan.ok(
        {
          targetDatabase: "[redacted]",
          skipped: false,
          tableCount: (tables.rows ?? []).length,
          tables: (tables.rows ?? []).map((r) => ({ table: r.table_name, columns: Number(r.columns), rows: null })),
          indexCount: indexRows.length,
          indexes: indexRows.map((r) => ({ table: r.tablename, index: r.indexname, definition: r.indexdef })),
          missingIndexes: missingIndexes.map((r) => ({ table: r.table_name, column: r.column_name })),
        },
        ["raw/database_inventory.json"],
        warnings,
      );
    } finally {
      await pool.end();
    }
  } catch (err) {
    return scan.fail(err);
  }
}

/* ---------------- 5. runtime + env contract ---------------- */
export async function scanRuntime(target?: AuditTarget): Promise<ScanResult> {
  const scan = startScan("runtime-inventory");
  try {
    if (target && !target.rootValid) return scan.fail(target.rootInvalidReason ?? `invalid target root`);
    const root = target?.root ?? LEGACY_ROOT;
    const runtimeEndpoint = target?.runtimeEndpoint ?? null;

    let declared: string[] = [];
    try {
      const example = await readFile(path.join(root, ".env.example"), "utf-8");
      declared = example
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => l.split("=")[0].trim());
    } catch {
      /* no .env.example */
    }

    const present = declared.filter((k) => !!process.env[k]);
    const missing = declared.filter((k) => !process.env[k]);
    const warnings: string[] = [];
    if (missing.length) warnings.push(`${missing.length} declared env var(s) not set: ${missing.slice(0, 5).join(", ")}`);

    const insecureDefaults = declared.filter((k) => {
      const v = process.env[k];
      return !!v && /change-me|changeme|password|secret-secret/i.test(v);
    });
    if (insecureDefaults.length) warnings.push(`${insecureDefaults.length} env var(s) still hold placeholder values`);

    /* Probe the target runtime endpoint if configured. Without this, the
       runtime scanner only measures the auditor's own worker process —
       a false-green for the target system's health. */
    let remoteHealth: { ok: boolean; statusCode: number; latencyMs: number; body: string } | null = null;
    if (runtimeEndpoint) {
      try {
        const t0 = Date.now();
        const resp = await fetch(runtimeEndpoint, { signal: AbortSignal.timeout(5000) });
        const body = await resp.text();
        remoteHealth = {
          ok: resp.ok,
          statusCode: resp.status,
          latencyMs: Date.now() - t0,
          body: body.slice(0, 500),
        };
        if (!resp.ok) warnings.push(`target runtime endpoint returned ${resp.status}`);
      } catch (err) {
        remoteHealth = {
          ok: false,
          statusCode: 0,
          latencyMs: 0,
          body: err instanceof Error ? err.message : String(err),
        };
        warnings.push(`target runtime endpoint unreachable: ${remoteHealth.body}`);
      }
    } else {
      warnings.push("no TARGET_RUNTIME_ENDPOINT configured — measured worker process only, not target system");
    }

    return scan.ok(
      {
        node: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        cpus: os.cpus().length,
        memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
        uptimeSeconds: Math.round(process.uptime()),
        appMode: process.env.APP_MODE ?? "demo",
        nodeEnv: process.env.NODE_ENV ?? "development",
        env: { declared, present, missing, undeclared: [], insecureDefaults },
        runtimeEndpoint,
        remoteHealth,
      },
      ["raw/host_inventory.json", "raw/env_matrix.json"],
      warnings,
    );
  } catch (err) {
    return scan.fail(err);
  }
}

/* ---------------- 6. API route / service catalog ---------------- */
export async function scanRoutes(target?: AuditTarget): Promise<ScanResult> {
  const scan = startScan("route-inventory");
  try {
    const root = target?.root ?? LEGACY_ROOT;
    if (target && !target.rootValid) return scan.fail(target.rootInvalidReason ?? `invalid target root: ${root}`);
    if (!target) {
      const check = targetLooksValid();
      if (!check.valid) return scan.fail(check.reason);
    }
    const apiRoot = path.join(root, "src", "app", "api");
    if (!existsSync(apiRoot)) {
      return scan.fail(`no src/app/api under ${root} — source tree not available to the auditor`);
    }
    const routes: Array<{
      route: string;
      methods: string[];
      guarded: boolean;
      dynamic: boolean;
      publicByDesign?: string;
    }> = [];
    const warnings: string[] = [];

    async function walkRoutes(dir: string, prefix: string) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walkRoutes(full, `${prefix}/${e.name}`);
        else if (e.name === "route.ts") {
          const src = await readFile(full, "utf-8");
          const methods = ["GET", "POST", "PATCH", "PUT", "DELETE"].filter((m) =>
            new RegExp(`export async function ${m}\\b`).test(src),
          );
          const mutating = methods.some((m) => m !== "GET");
          const hasCheck = /getActor\s*\(/.test(src) && /hasPermission\s*\(/.test(src);
          /* Machine-readable waiver, e.g. login must be reachable while
             unauthenticated. Requires an explicit reason so the exemption is
             auditable instead of silent. */
          const waiver = /@public-endpoint\s+(.+)/.exec(src);
          const guarded = hasCheck || !!waiver;
          routes.push({
            route: `/api${prefix}`,
            methods,
            guarded,
            dynamic: prefix.includes("["),
            ...(waiver ? { publicByDesign: waiver[1].trim() } : {}),
          } as (typeof routes)[number]);
          if (mutating && !guarded) {
            warnings.push(`/api${prefix} exposes ${methods.filter((m) => m !== "GET").join("/")} without a permission check`);
          }
        }
      }
    }
    await walkRoutes(apiRoot, "");

    const pageRoot = path.join(root, "src", "app");
    const pages: string[] = [];
    for (const e of await readdir(pageRoot, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== "api" && existsSync(path.join(pageRoot, e.name, "page.tsx"))) {
        pages.push(`/${e.name}`);
      }
    }
    if (existsSync(path.join(pageRoot, "page.tsx"))) pages.unshift("/");

    return scan.ok(
      {
        routeCount: routes.length,
        mutatingRoutes: routes.filter((r) => r.methods.some((m) => m !== "GET")).length,
        unguardedMutating: routes.filter((r) => r.methods.some((m) => m !== "GET") && !r.guarded).map((r) => r.route),
        routes,
        pages,
        streaming: routes.filter((r) => r.route.includes("/stream")).map((r) => r.route),
      },
      ["raw/route_inventory.json"],
      warnings,
    );
  } catch (err) {
    return scan.fail(err);
  }
}

/** Each scanner is tagged with its scope so the engine can filter by the
 *  audit request's `scope` field. A scanner whose scope is NOT in the
 *  target's scope list is skipped — e.g. an audit scoped to ["filesystem",
 *  "packages"] won't touch the database. */
export const SCANNER_SCOPES: Record<string, Scope> = {
  "filesystem-inventory": "filesystem",
  "package-inventory": "packages",
  "secret-scan": "secrets",
  "database-inventory": "database",
  "runtime-inventory": "runtime",
  "route-inventory": "routes",
};

export const DISCOVERY_SCANNERS = [
  scanFilesystem,
  scanPackages,
  scanSecrets,
  scanDatabase,
  scanRuntime,
  scanRoutes,
] as const;

/** Run only the scanners whose scope is enabled for the target. Returns
 *  [scanner, scope] pairs so the caller can log which scanner ran.
 *
 *  DB scanner is additionally gated by `databaseScopeEnabled` — if no
 *  target DB URL is configured, the DB scanner is skipped entirely
 *  (fail-closed) instead of falling back to the control plane's own DB. */
export function scannersForTarget(target: AuditTarget): Array<{
  name: string;
  scope: Scope;
  run: () => Promise<ScanResult>;
}> {
  const all: Array<{ name: string; run: (t?: AuditTarget) => Promise<ScanResult> }> = [
    { name: "filesystem-inventory", run: scanFilesystem },
    { name: "package-inventory", run: scanPackages },
    { name: "secret-scan", run: scanSecrets },
    { name: "database-inventory", run: scanDatabase },
    { name: "runtime-inventory", run: scanRuntime },
    { name: "route-inventory", run: scanRoutes },
  ];
  return all
    .filter((s) => {
      if (!scopeEnabled(target, SCANNER_SCOPES[s.name])) return false;
      /* DB scanner: fail-closed — skip if no target DB URL */
      if (s.name === "database-inventory" && !databaseScopeEnabled(target)) return false;
      return true;
    })
    .map((s) => ({
      name: s.name,
      scope: SCANNER_SCOPES[s.name],
      run: () => s.run(target),
    }));
}
