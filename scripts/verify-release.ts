import "dotenv/config";
/* Harness: verifies the release prerequisites that previously blocked a
 * reproducible build/package of the desktop client and the Docker migrator.
 *
 * Checks (no DB required — pure filesystem + version consistency):
 *   1. package-lock.json exists and is in sync with package.json (npm ci works)
 *   2. Dockerfile copies drizzle.config.ts + package.json into the migrator image
 *   3. all Tauri icons referenced by tauri.conf.json exist on disk
 *   4. version is consistent across package.json, Cargo.toml, tauri.conf.json,
 *      src/lib/version.ts, and the artifact schema default
 *   5. beforeBuildCommand is a real npm script (not a missing sidecar build)
 *
 * Exit 0 only if every check passed. */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

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
  /* ---------- 1. package-lock.json present + npm ci would work ---------- */
  const lockPath = path.join(ROOT, "package-lock.json");
  check("package-lock.json exists (npm ci precondition)", existsSync(lockPath));
  if (existsSync(lockPath)) {
    const lock = await readJson(lockPath);
    const pkg = await readJson(path.join(ROOT, "package.json"));
    const lockName = (lock.packages?.[""]?.name ?? lock.name) as string | undefined;
    const lockVersion = (lock.packages?.[""]?.version ?? lock.version) as string | undefined;
    check("package-lock.json root matches package.json name+version", !!lockName && lockName === pkg.name && !!lockVersion && lockVersion === pkg.version, `${lockName}@${lockVersion} vs ${pkg.name}@${pkg.version}`);
  }

  /* ---------- 2. Dockerfile migrator copies drizzle.config.ts + package.json ---------- */
  const dockerfile = await readFile(path.join(ROOT, "Dockerfile"), "utf-8");
  check("Dockerfile copies drizzle.config.ts into the image", /COPY\b.*\bdrizzle\.config\.ts\b/.test(dockerfile));
  check("Dockerfile copies package.json into the image", /COPY\b.*\bpackage\.json\b/.test(dockerfile));

  /* ---------- 3. Tauri icons referenced by tauri.conf.json exist ---------- */
  const tauriConf = await readJson(path.join(ROOT, "src-tauri/tauri.conf.json"));
  const iconList = (tauriConf.bundle?.icon ?? []) as string[];
  check("tauri.conf.json declares at least one icon", iconList.length > 0, `${iconList.length} icons`);
  for (const icon of iconList) {
    const resolved = icon.startsWith("icons/") ? path.join(ROOT, "src-tauri", icon) : path.join(ROOT, "src-tauri", icon);
    check(`icon exists: ${icon}`, existsSync(resolved));
  }

  /* ---------- 4. version consistency ---------- */
  const pkg = await readJson(path.join(ROOT, "package.json"));
  const cargo = await readFile(path.join(ROOT, "src-tauri/Cargo.toml"), "utf-8");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

  /* ---------- 4b. Cargo.lock exists (reproducible Rust builds) ---------- */
  /* For binary applications, Cargo.lock MUST be committed so that dependency
     versions are pinned between builds. Without it, `cargo build` may pick
     different crate versions on each run, producing non-reproducible binaries. */
  const cargoLockPath = path.join(ROOT, "src-tauri/Cargo.lock");
  check("src-tauri/Cargo.lock exists (reproducible Rust builds)", existsSync(cargoLockPath));
  const versionModule = await readFile(path.join(ROOT, "src/lib/version.ts"), "utf-8");
  const moduleVersion = versionModule.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
  /* GENERATOR_VERSION may be a string literal or an alias `= APP_VERSION`.
     Either way it resolves to APP_VERSION's value; verify the alias form too. */
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

  /* ---------- 5. beforeBuildCommand is a real npm script ---------- */
  const beforeBuild = (tauriConf.build?.beforeBuildCommand ?? "") as string;
  const npmScripts = (pkg.scripts ?? {}) as Record<string, string>;
  const cmd = beforeBuild.split(/\s+/)[0];
  const scriptName = beforeBuild.match(/npm run (\S+)/)?.[1];
  const isNpmRun = cmd === "npm" && !!scriptName && scriptName in npmScripts;
  check("beforeBuildCommand references a real npm script", isNpmRun, beforeBuild || "(empty)");

  /* ---------- summary ---------- */
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} release checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
