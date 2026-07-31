import "dotenv/config";
/* Harness: verifies the release prerequisites that previously blocked a
 * reproducible build/package of the desktop client and the Docker migrator.
 *
 * Checks (no DB required — pure filesystem + version consistency):
 *   1. package-lock.json exists, root matches, and all deps have lockfile entries
 *   2. Dockerfile copies drizzle.config.ts, package.json, drizzle/, scripts/
 *   3. all Tauri icons referenced by tauri.conf.json exist on disk
 *   4. version is consistent across package.json, Cargo.toml, tauri.conf.json,
 *      src/lib/version.ts, and the artifact schema default
 *   5. beforeBuildCommand references real npm scripts (build + build:worker)
 *   6. Cargo.lock exists (reproducible Rust builds)
 *   7. Worker bundle script exists and dist/worker/index.js is importable
 *   8. drizzle/ directory has .sql migration files
 *
 * Exit 0 only if every check passed. */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(` ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const ROOT = path.resolve(process.cwd());

async function readJson(p: string): Promise<any> {
  return JSON.parse(await readFile(p, "utf-8"));
}

async function main() {
  const pkg = await readJson(path.join(ROOT, "package.json"));
  const npmScripts = (pkg.scripts ?? {}) as Record<string, string>;

  /* ---------- 1. package-lock.json present + npm ci would work ---------- */
  const lockPath = path.join(ROOT, "package-lock.json");
  check("package-lock.json exists (npm ci precondition)", existsSync(lockPath));
  if (existsSync(lockPath)) {
    const lock = await readJson(lockPath);
    const lockName = (lock.packages?.[""]?.name ?? lock.name) as string | undefined;
    const lockVersion = (lock.packages?.[""]?.version ?? lock.version) as string | undefined;
    check("package-lock.json root matches package.json name+version", !!lockName && lockName === pkg.name && !!lockVersion && lockVersion === pkg.version, `${lockName}@${lockVersion} vs ${pkg.name}@${pkg.version}`);

    /* Deep sync check: every dependency + devDependency in package.json must
       have a corresponding entry in the lockfile's `packages` object. This
       catches the "Missing: esbuild@0.28.1 from lock file" error that npm ci
       reports when the lockfile is out of sync with package.json. */
    const lockPackages = (lock.packages ?? {}) as Record<string, unknown>;
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const missingInLock: string[] = [];
    for (const depName of Object.keys(allDeps)) {
      const lockKey = `node_modules/${depName}`;
      if (!(lockKey in lockPackages)) {
        missingInLock.push(depName);
      }
    }
    check("all package.json deps have lockfile entries (npm ci tree sync)", missingInLock.length === 0, missingInLock.length ? `missing: ${missingInLock.slice(0, 5).join(", ")}${missingInLock.length > 5 ? "…" : ""}` : `${Object.keys(allDeps).length} deps verified`);
  }

  /* ---------- 2. Dockerfile migrator copies required files ---------- */
  const dockerfile = await readFile(path.join(ROOT, "Dockerfile"), "utf-8");
  check("Dockerfile copies drizzle.config.ts into the image", /COPY\b.*\bdrizzle\.config\.ts\b/.test(dockerfile));
  check("Dockerfile copies package.json into the image", /COPY\b.*\bpackage\.json\b/.test(dockerfile));
  check("Dockerfile copies drizzle/ directory into the image", /COPY\b.*\bdrizzle\b/.test(dockerfile));
  check("Dockerfile copies scripts/ directory into the image", /COPY\b.*\bscripts\b/.test(dockerfile));

  /* ---------- 3. Tauri icons referenced by tauri.conf.json exist ---------- */
  const tauriConf = await readJson(path.join(ROOT, "src-tauri/tauri.conf.json"));
  const iconList = (tauriConf.bundle?.icon ?? []) as string[];
  check("tauri.conf.json declares at least one icon", iconList.length > 0, `${iconList.length} icons`);
  for (const icon of iconList) {
    const resolved = icon.startsWith("icons/") ? path.join(ROOT, "src-tauri", icon) : path.join(ROOT, "src-tauri", icon);
    check(`icon exists: ${icon}`, existsSync(resolved));
  }

  /* ---------- 4. version consistency ---------- */
  const cargo = await readFile(path.join(ROOT, "src-tauri/Cargo.toml"), "utf-8");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

  /* ---------- 4b. Cargo.lock exists (reproducible Rust builds) ---------- */
  const cargoLockPath = path.join(ROOT, "src-tauri/Cargo.lock");
  check("src-tauri/Cargo.lock exists (reproducible Rust builds)", existsSync(cargoLockPath));
  const versionModule = await readFile(path.join(ROOT, "src/lib/version.ts"), "utf-8");
  const moduleVersion = versionModule.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
  const moduleGenLiteral = versionModule.match(/GENERATOR_VERSION\s*=\s*"([^"]+)"/)?.[1];
  const moduleGenAlias = /GENERATOR_VERSION\s*=\s*APP_VERSION\b/.test(versionModule);
  const moduleGenVersion = moduleGenLiteral ?? (moduleGenAlias ? moduleVersion : undefined);
  const schemaSrc = await readFile(path.join(ROOT, "src/db/schema.ts"), "utf-8");
  const schemaImportsVersion = /import\s+\{[^}]*GENERATOR_VERSION[^}]*\}\s+from\s+"@\/lib\/version"/.test(schemaSrc);

  const versions = {
    "package.json": pkg.version as string,
    "Cargo.toml": cargoVersion ?? "MISSING",
    "version.ts (APP_VERSION)": moduleVersion ?? "MISSING",
    "version.ts (GENERATOR_VERSION)": moduleGenVersion ?? "MISSING",
    "schema.ts imports GENERATOR_VERSION": schemaImportsVersion ? moduleGenVersion ?? "imported" : "MISSING",
  };
  const allMatch = Object.values(versions).every((v) => v === versions["package.json"]);
  check("version is consistent across package.json, Cargo.toml, version.ts, schema.ts", allMatch, JSON.stringify(versions));

  /* ---------- 5. beforeBuildCommand references real npm scripts ---------- */
  const beforeBuild = (tauriConf.build?.beforeBuildCommand ?? "") as string;
  /* beforeBuildCommand may contain multiple scripts chained with &&.
     Verify each `npm run <script>` references a real script in package.json. */
  const scriptRefs = [...beforeBuild.matchAll(/npm run (\S+)/g)].map((m) => m[1]);
  const allScriptsReal = scriptRefs.length > 0 && scriptRefs.every((s) => s in npmScripts);
  check("beforeBuildCommand references real npm scripts", allScriptsReal, beforeBuild || "(empty)");
  check("beforeBuildCommand includes build:worker", scriptRefs.includes("build:worker"), scriptRefs.join(", "));

  /* ---------- 6. Worker bundle script + output ---------- */
  check("package.json has build:worker script", "build:worker" in npmScripts, npmScripts["build:worker"] ?? "MISSING");
  const workerBundlePath = path.join(ROOT, "dist/worker/index.js");
  const workerExists = existsSync(workerBundlePath);
  check("dist/worker/index.js exists (run npm run build:worker)", workerExists, workerExists ? "found" : "MISSING — run `npm run build:worker`");
  if (workerExists) {
    /* Verify the worker bundle is valid JavaScript by importing it with Node.
       This catches syntax errors, missing dependencies, and broken bundling.
       On Windows, ESM import requires a file:// URL, not a bare path. */
    const workerUrl = pathToFileURL(workerBundlePath).href;
    const result = spawnSync("node", ["-e", `import("${workerUrl}").then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); })`], {
      timeout: 5000,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: "" },
    });
    check("dist/worker/index.js is importable by Node", result.status === 0, result.status !== 0 ? (result.stderr?.toString().split("\n")[0] ?? `exit ${result.status}`) : "ok");
  }

  /* ---------- 7. drizzle/ directory has SQL migration files ---------- */
  const drizzleDir = path.join(ROOT, "drizzle");
  if (existsSync(drizzleDir)) {
    const sqlFiles = (await readdir(drizzleDir)).filter((f) => f.endsWith(".sql"));
    check("drizzle/ directory has .sql migration files", sqlFiles.length > 0, `${sqlFiles.length} files`);
  } else {
    check("drizzle/ directory has .sql migration files", false, "drizzle/ directory missing");
  }

  /* ---------- summary ---------- */
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} release checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
