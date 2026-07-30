# AI Agent OS — Control Plane + Deterministic Auditor

> **Trạng thái: Alpha / MVP (v0.5.0).** Đây là **lớp Control Plane + Auditor** của kiến trúc AI Agent OS,
> **chưa phải toàn bộ hệ điều hành agent**. Auditor hiện là **rule-based deterministic**, chưa có
> LLM reasoning. Xem [Thật vs Mô phỏng](#thật-vs-mô-phỏng) để biết chính xác phần nào đã chạy thật.

Audit · Architecture · Recovery · Functional Parity — xây từ **design system + components + dữ liệu đo được**.

## Thật vs Mô phỏng

| Hạng mục | Trạng thái |
|---|---|
| Audit filesystem/package/secret/DB/runtime/route | **Thật** — 6 scanner đo hệ thống, target-aware (root + DB riêng theo environment) |
| Findings, SBOM, README, runbook, parity | **Thật** — suy ra từ dữ liệu đo |
| Auth, session ký HMAC, RBAC, approval, audit log | **Thật** — handler-level `requirePermission` trên mọi GET route, không chỉ mutating |
| PostgreSQL queue, claim SKIP LOCKED, heartbeat (lease-fenced + background timer), atomic stale recovery | **Thật** |
| Job `audit.run` (pipeline 3 tầng) | **Thật** — worker chạy engine thật, scope filter quyết định scanner nào chạy, lease-lost abort |
| Job `sbom.export` / `parity.gate` / `artifact.package` | **Thật** — executor sinh artifact/bundle thật (TAR+checksum, SBOM CycloneDX, parity report); mỗi side effect được lease-fence qua `assertLease()` |
| Job `knowledge.reindex` | **Thật** — xây inverted index (Unicode-aware); scoped reindex MERGE vào index toàn cục và xóa postings của artifact đã bị xóa khỏi audit; search API dùng index khi có, fallback ILIKE |
| Telemetry (latency/throughput/error rate) | **Synthetic (demo) / Unavailable (prod)** — OTLP chưa nối; API trả `source` field để UI không hiển thị số fake mà không cảnh báo |
| Telemetry radar (traces/metrics/logs/baggage) | **Synthetic** — luôn `radar.source: "synthetic"`, tách khỏi telemetry `source` để UI badge radar độc lập |
| Parity score | **Fail-closed** — 0 checks → `score: 0, status: failed` (không phải 100/passed false-green) |
| Parity `db_schema` | **Fail-closed** — DB scanner bị skip/thất bại → `pending` (không phải `passed`); không bao giờ "No missing indexes" khi DB chưa đo |
| Target DB scanner | **Fail-closed** — không có `TARGET_DATABASE_URL` → skip, không fallback control-plane DB |
| Target root (production/staging) | **Fail-closed** — thiếu `AUDIT_TARGET_ROOT_{ENV}`/`AUDIT_TARGET_ROOT` → root `invalid`, không quét `process.cwd()` của worker |
| Target runtime endpoint | **Thật khi có `TARGET_RUNTIME_ENDPOINT`** — probe health endpoint; không có → đo worker process only + warning |
| Audit target binding theo environment | **Thật** — `AUDIT_TARGET_ROOT_{ENV}`, `TARGET_DATABASE_URL_{ENV}`, `TARGET_RUNTIME_ENDPOINT_{ENV}` |
| Node Hermes/OpenClaw/OpenCode trên graph | **Seed data** — chưa service discovery |
| GitHub push, Docker inspect, Trivy/Syft/Gitleaks binary | **Chưa có** |
| Agent orchestration, planner, model router, MCP, sandbox | **Chưa có** |
| OTLP ingestion thật | **Chưa có** — `source: "otlp"` chưa bao giờ trả |
| Docker image build trong CI | **Có** — CI build + smoke test Docker image |
| Tauri desktop distributable | **Chưa hoàn thành** — shell scaffold có, chưa build theo OS matrix, CSP null, cần Node+PG ngoài |
| Production rules enforcement | **Chưa có** — rules là setting/UI only, backend chưa enforce |
| Login rate limit / account lockout | **Chưa có** |
| Cookie `Secure` flag production | **Chưa có** — login route chưa set `Secure` |

## Kiến trúc

```text
┌──────────────────────────────────────────────────┐
│  Next.js 16 Control Plane (UI + API routes)      │
│  React Flow · Recharts · TanStack Query · Zustand │
└───────┬───────────────────┬──────────────────────┘
        │ REST + SSE        │ SQL
┌───────▼────────┐   ┌──────▼─────────────┐   ┌──────────────┐
│ PostgreSQL     │◄──│ Worker (production)│   │ Auditor      │
│ state + queue  │   │ DB queue (SKIP     │   │ Engine       │
│                │   │ LOCKED claim)      │   │ (real, 6 sc) │
└────────────────┘   └────────────────────┘   └──────────────┘
```

Nguyên tắc bất biến: **Auditor không can thiệp runtime** — DB SELECT only, mọi hành động nhạy cảm đều qua **human-in-the-loop approval**. (GitHub push / Docker inspect nằm trong roadmap, chưa triển khai.)

## Demo mode vs Production mode

`APP_MODE` tách hoàn toàn simulation khỏi vận hành thật:

| | `APP_MODE=demo` (mặc định) | `APP_MODE=production` |
|---|---|---|
| Audit engine | timeline mô phỏng inline trong API request | **scanner thật** chạy trong worker process (`src/services/auditor/`) |
| Findings | rút từ `FINDING_POOL` | **suy ra từ dữ liệu đo được** (secret hits, route hở, index thiếu, env drift) |
| Artifacts | template dựng sẵn | **sinh từ inventory thật** (SBOM từ `node_modules`, mermaid từ route inventory) |
| Jobs | inline-runner (`locked_by=inline-demo`) | claim bởi worker (`FOR UPDATE SKIP LOCKED`) |
| Telemetry | synthetic random-walk sampler (`source: "synthetic"`) | không có sampler — `source: "unavailable"`, `current: null` (OTLP ingestion là điểm cắm `src/services/telemetry.ts`, chưa nối) |
| Seed | cho phép | **bị chặn** (cần `SEED_ALLOW=1`) |

Header của Audit Center hiển thị badge `engine: demo timeline` / `engine: real scanners` để không ai nhầm hai chế độ.

## Auditor Engine thật (`APP_MODE=production`)

Sáu scanner chạy **read-only** trên target system — không spawn process, không ghi, không mutate. Target được resolve từ audit request (`environment` + `scope`) qua `resolveTarget()`:

- **Root**: `AUDIT_TARGET_ROOT` env var (Tauri shell/compose set) hoặc `process.cwd()`. Với `production`/`staging`, bắt buộc `AUDIT_TARGET_ROOT_{ENV}` (hoặc `AUDIT_TARGET_ROOT`) — nếu thiếu, root bị đánh dấu `invalid` (fail-closed) thay vì quét repo của worker.
- **Database**: `TARGET_DATABASE_URL` env var — nếu set, DB scanner kết nối **DB đích**, không phải control plane's own DB (tránh false-green: auditor's DB luôn healthy vì auditor đang chạy). Nếu không set, DB scanner bị skip và parity `db_schema` trả `pending` (không phải `passed`).
- **Scope**: audit request's `scope` field lọc scanner — `["filesystem", "packages"]` chỉ chạy 2 scanner đó
- **Provenance**: mỗi artifact ghi `targetRoot`, `commitSha`, `environment`, `scope` vào metadata

| Scanner | Làm gì thật | Bằng chứng sinh ra |
|---|---|---|
| `filesystem-inventory` | walk repo, đếm file/LOC theo extension, kiểm tra lockfile & config bắt buộc | `host_inventory.json`, `repo_inventory.json` |
| `package-inventory` | đọc `package.json` + resolve version/license thật từ `node_modules` | `package_inventory.json` → CycloneDX SBOM |
| `secret-scan` | 6 rule kiểu gitleaks (AWS key, private key block, bearer, postgres URL có password…) + allowlist | `security_scan.json` |
| `database-inventory` | `information_schema` + `pg_indexes` **SELECT only**, phát hiện hot column thiếu index | `database_inventory.json` |
| `runtime-inventory` | node/platform/uptime + đối chiếu `.env.example` ↔ `process.env`, bắt giá trị placeholder | `env_matrix.json` |
| `route-inventory` | phân tích tĩnh `src/app/api/**/route.ts`: methods, có `getActor()+hasPermission()` hay không | `service_catalog.json` |

Findings **không phải template** — ví dụ thật mà engine tự phát hiện:
- `package-lock.json` thiếu → critical (`npm ci` sẽ fail)
- route mutating không có permission check → high
- cột hot path chưa có index → medium (đọc từ `pg_indexes`)
- env var còn giá trị `change-me` → high

Endpoint public hợp lệ (login/logout) khai báo waiver máy đọc được — có lý do, có thể audit:

```ts
// @public-endpoint Authentication entry point — must be reachable while unauthenticated.
```

Parity score cũng tính từ inventory thật: route count, env contract, index count, **endpoint authorization**, p95 latency.

Service layer tại `src/services/` (`mode.ts` + `audit.ts` + `jobs.ts` + `telemetry.ts` + `auditor/`) — thay implementation mà không đụng API routes.

## Bắt đầu

```bash
cp .env.example .env        # điền DATABASE_URL, API_INTERNAL_TOKEN, SESSION_SECRET
npm ci
npm run db:push             # npx drizzle-kit push --force
npm run db:seed             # npx tsx src/db/seed.ts   (demo only)
npm run dev
```

Hoặc bằng Docker — **hai profile tách biệt, không bao giờ chạy đồng thời**:

```bash
docker compose --profile demo up --build        # dashboard (demo timeline), KHÔNG worker
docker compose --profile production up --build  # dashboard (enqueue) + worker (engine thật)
docker compose --profile cache up -d redis      # tuỳ chọn: chỉ khi cần rate-limit/pub-sub
```

Queue nằm trong PostgreSQL (`FOR UPDATE SKIP LOCKED`) nên **Redis không bắt buộc** ở giai đoạn single-node — nó chỉ nằm dưới profile `cache` để không chạy "cho đủ stack".

## Tài khoản demo (seed)

| Username | Password | Role | Quyền chính |
|---|---|---|---|
| `admin` | `AgentOS#admin` | administrator | + `approval:approve`, `settings:update` |
| `operator.han` | `AgentOS#ops` | operator | `audit:run`, `finding:update`, `job:create` |
| `viewer` | `AgentOS#view` | viewer | read-only |

Mọi endpoint **mutating** (`POST /api/audits/run`, `PATCH /api/findings`, `POST /api/jobs`, `PUT /api/settings`, `POST /api/approvals/:id`) đều yêu cầu session hoặc service token. Mọi endpoint **GET** cũng gọi `requirePermission()` ở handler-level — middleware Edge chỉ kiểm tra *sự hiện diện* của credentials (fast gate), handler validate *tính hợp lệ* (signature, DB session, role). Một fake cookie `aos_session=fake` qua middleware nhưng bị `getActor()` reject → 401. Mọi thay đổi trạng thái ghi vào **audit_logs bất biến**.

**Service-to-service**: mỗi service có token riêng (`AUDITOR_SERVICE_TOKEN`, `WORKER_SERVICE_TOKEN`) và role được suy ra từ **token nào khớp** — không đọc từ header `x-service-name` do client gửi, tránh việc một token chung cho phép tự khai role cao hơn.

## Human-in-the-loop (production approval flow)

1. Operator bấm **Run Audit** với environment = `production` → audit vào trạng thái `waiting_approval`, hệ thống tạo approval request.
2. Administrator mở **Audit Center → Approvals** → Approve/Reject.
3. Approve → pipeline 3 tầng thực sự chạy; Reject → audit `cancelled`.
4. Khi audit hoàn tất → tự sinh approval `artifact.package` (Package reconstruction bundle — local TAR artifact với checksum, chưa push GitHub) — gate cuối của lifecycle pipeline trên Overview. Approve → tạo job `artifact.package` → executor thật đóng gói TAR + SHA256 + manifest (loại trừ bundle cũ để không self-include).

## REST API

```text
GET  /api/health                 (public — Docker/CI/Tauri healthcheck, không cần credentials)
GET  /api/system/health          (auth — system health chi tiết)
GET  /api/system/components      GET  /api/telemetry/summary
GET  /api/architecture/graph     GET  /api/jobs            POST (auth)
GET  /api/audits[?from&to&status&environment]
POST /api/audits/run             (auth — idempotencyKey + approval gate)
GET  /api/audits/{id}
GET  /api/parity/latest          (kèm baselineDiff so với báo cáo trước)
GET  /api/findings[?severity&status&component&q]   PATCH (auth)
GET  /api/artifacts[/id]         (sha256 + generator metadata)
GET  /api/approvals              POST /api/approvals/{id} (admin)
GET  /api/audit-logs
GET  /api/search?q=              (xuyên components/audits/findings/artifacts/jobs — dùng inverted index khi có)
GET  /api/stream/events          (SSE — client tự fallback polling)
POST /api/auth/login|logout      GET /api/auth/me
```

`/api/health` là endpoint public tối giản (chỉ trả `ok: true` + app identity) cho Docker/CI/Tauri healthcheck. `/api/system/health` là endpoint auth-required cho health chi tiết.

Response được **parse qua Zod contracts** (`src/lib/contracts.ts`) trước khi serialize — không còn ép kiểu mù cho các DTO parse-critical.

## Scripts

```bash
make dev build start      # vòng đứng app
make db-push db-seed      # schema + demo data
make worker               # APP_MODE=production worker (DB queue)
make test                 # 90 unit tests (Vitest)
make docker-up            # full stack qua compose
```

## Testing & CI

- **Vitest**: `tests/unit/` — audit stage machine, parity scoring/diff (fail-closed, db_schema fail-closed), lease fence (LeaseLostError, heartbeat eviction), knowledge index (Unicode tokenizer, scoped deletion), self-approval forbid, contracts, auth (scrypt, role permissions, requirePermission 401/403), utils. **90 tests, all green locally trên Node 22 / npm 10.9.8.**
- **GitHub Actions** (`.github/workflows/ci.yml`): install → lint → typecheck → push schema → **verify migrations apply trên DB sạch** (`db:migrate` vào database trống riêng, đếm rows `__drizzle_migrations`, kiểm tra bảng `audits` được tạo) → seed → tests → verify:worker → verify:executors → verify:release → build → API smoke test với PostgreSQL service → Docker build + smoke (với `--add-host=host.docker.internal:host-gateway` cho Linux runner).
- **Toolchain**: Node 22 + npm 10.9.8 là canonical (CI và Docker cùng dùng Node 22). `package.json` khai báo `engines`, `.nvmrc` pin Node 22. Lockfile phải được tạo/cập nhật bằng npm 10 — npm 11 (Node 24) sinh layout `tsx → esbuild` khác và `npm ci` trên CI (npm 10) sẽ từ chối.
- **CI status**: các bước migration/executor/Docker verification đã được thêm vào workflow nhưng **chưa từng chạy xanh trên GitHub** do lockfile mismatch (đã sửa trong branch này, chờ merge). Không tuyên bố "CI verification complete" cho đến khi run mới nhất pass.

## Worker (production queue)

```bash
npm run worker              # mode từ .env
APP_MODE=production npm run worker
```

**Ownership rule**: mỗi `audit.run` job mang `auditId`; worker chỉ chạy audit của job **chính nó đã claim** (`locked_by = workerId`, `lease_token = token`). Quét `audits WHERE status='running'` sẽ khiến hai worker cùng chạy một audit — đó là lỗi đã được sửa và có regression test. `advanceJobsOnce(workerId)` cũng lọc theo `locked_by` cho non-audit jobs, nên hai worker không cùng advance một job.

- **Lease fencing**: `heartbeat()` và `setJobProgress()` dùng `RETURNING` — nếu stale supervisor requeue job (clear lease_token) và worker khác claim, update từ worker cũ match 0 rows → throw `LeaseLostError` → worker cũ dừng ngay, không ghi thêm. `assertLease()` kiểm tra trước mỗi nhóm side effect (scanner, findings, reconstruction, finalize). **Non-audit executors** cũng nhận một `LeaseFence` và gọi `assert()` trước mỗi ghi (artifact upsert, parity report, settings insert) — worker cũ không tiếp tục ghi artifact/report đè lên run của worker mới. Background heartbeat timer 15s giữ job alive khi scanner/executor chạy lâu.
- **LEASE_LOST exit**: khi lease bị mất, worker cũ không sửa audit/job state, không requeue/fail (để worker mới xử lý), chỉ phát event `job.requeued` cảnh báo (observability, không phải state mutation)
- Claim: `FOR UPDATE SKIP LOCKED`, `attempt < max_attempts`, **`LIMIT 1`** (worker xử lý tuần tự; claim 3 sẽ để 2 job kẹt `running` không heartbeat cho đến khi stale supervisor requeue)
- **Retry đúng maxAttempts**: non-audit executor error → requeue (`status: "queued"`) khi `attempt < maxAttempts`, fail khi hết. Trước đây luôn `status: "failed"` bỏ qua retry budget
- Heartbeat trong suốt audit; job hoàn tất **cùng** audit trong một transaction (parity upsert + audit→completed + event + job→completed + approval `artifact.package` commit cùng nhau)
- Stale recovery **atomic**: `UPDATE … WHERE heartbeat < now()-45s RETURNING` per outcome (không SELECT-then-UPDATE-by-id); bao gồm `audit.run`: requeue khi heartbeat > 45s, `timed_out` + audit `failed` khi hết attempts
- Resume idempotent: `UNIQUE(audit_id, path)` cho artifacts, `UNIQUE(audit_id, fingerprint)` cho findings, `UNIQUE(audit_id)` cho parity reports → retry ghi đè, không nhân bản
- `UNIQUE(idempotency_key)` (partial, `WHERE NOT NULL`) + xử lý conflict → hai request đồng thời cùng idempotency key không tạo hai audit
- **Active-audit exclusivity**: `UNIQUE partial index ON (1) WHERE status IN ('running','waiting_approval')` → chỉ một audit active tại một thời điểm, đóng lỗ hổng SELECT-then-INSERT race (hai request khác idempotency key đều qua check active rồi cùng insert)
- Approval quyết định atomic (`UPDATE … WHERE status='pending' RETURNING`) → không double-spawn job
- **Self-approval forbidden**: requester không thể approve/reject yêu cầu của chính mình (trừ `requestedBy="system"`) — production approval yêu cầu **second person sign-off**, đúng như mô tả

Kiểm chứng bằng 23 assertion thật:

```bash
npm run verify:worker    # lifecycle, concurrency, resume, stale recovery, approval race
npm run audit:verify     # chạy engine thật, verify sha256 mọi artifact
```

## Realtime

`GET /api/stream/events` — Server-Sent Events phát từ bảng `events` (delta theo id, heartbeat 15s). Frontend (`EventsFeed`) dùng `EventSource`; khi stream rơi tự chuyển sang polling 5s, hiển thị trạng thái `SSE live` / `polling`.

## Telemetry provenance

`GET /api/telemetry/summary` trả field `source` để UI không bao giờ hiển thị số fake mà không cảnh báo:

| `source` | Ý nghĩa | `current` / `radar` |
|---|---|---|
| `otlp` | collector thật đã ingest points (chưa có ingestion code, nên chưa bao giờ trả giá trị này) | có dữ liệu |
| `synthetic` | demo-mode random-walk sampler (`sampleTelemetryOnce`) ghi rows | có dữ liệu (nguồn là `Math.sin`/random-walk, không phải app) |
| `unavailable` | không collector, không sampler | `null` — không fallback fabricated |

UI (`DataSourceBadge`) hiển thị badge theo `source`: `otlp live` / `synthetic data — no collector` / `no telemetry — collector not connected`. Trước đây production không collector vẫn hiện 128ms/1284rps/radar đầy đủ không cảnh báo — false provenance đã sửa.

**Radar provenance**: radar panel (traces/metrics/logs/baggage) luôn có `radar.source: "synthetic"` — tách khỏi telemetry `source` để UI không bao giờ hiển thị "otlp live" cho radar khi telemetry `source` là `otlp`. Radar là decorative, không có backing data source trong cả demo lẫn production.

## Desktop packaging (Tauri 2)

App có API routes + PostgreSQL + session server-side + SSE, nên **không dùng static export** (`output: "export"` sẽ xoá hết những thứ đó). Shell chạy theo Hướng A:

```text
Tauri shell (Rust)
  ├── spawn  node .next/standalone/server.js   (bundled resource)
  ├── poll   127.0.0.1:3000 tới khi listen
  ├── show   WebView → http://127.0.0.1:3000
  └── kill   server khi đóng cửa sổ
```

Nếu :3000 đã có service khác (dev server / service cài sẵn), shell attach thay vì spawn trùng. Next giữ `output: "standalone"`; `bundle.resources` copy `.next/standalone` + `.next/static` + `public/` vào installer.

```bash
npm run build && cargo tauri build   # .msi/.nsis/.dmg/.AppImage/.deb
```

Chi tiết + roadmap (Node sidecar, system tray, local service manager): [`src-tauri/README.md`](src-tauri/README.md).

## Cấu trúc

```text
src/
├── app/                  # 7 trang + 20 API routes + error/loading/not-found
├── components/           # shell, architecture (React Flow), audit, parity,
│                         # observability, knowledge, workflow, ui kit, feedback
├── db/                   # Drizzle schema (13 bảng) + seed
├── lib/                  # contracts (Zod), auth, audit-log, parity, stores
├── services/             # mode, audit (runner+engine), jobs (queue), telemetry
│   └── auditor/          # engine, scanners (target-aware), normalize, target
├── worker/               # production worker process
├── middleware.ts         # gate nhanh (presence check) — handler validate thật
tests/unit/               # Vitest
src-tauri/                # desktop scaffold
```

## Roadmap (từ review)

- [x] ~~Executor thật cho `sbom.export` / `parity.gate` / `artifact.package` / `knowledge.reindex`~~ — đã triển khai
- [x] ~~Auth bypass: GET routes chỉ check presence, không validate~~ — đã sửa
- [x] ~~Lease fencing: heartbeat/progress không lọc lease_token~~ — đã sửa (RETURNING + LeaseLostError + background timer + assertLease)
- [x] ~~Parity false-green: 0 checks → 100/passed~~ — đã sửa (fail-closed: 0/failed)
- [x] ~~Telemetry radar provenance: synthetic data hiển thị như otlp~~ — đã sửa (UI dùng `radar.source`)
- [x] ~~Knowledge index không dùng trong search~~ — đã sửa (search API dùng inverted index, Unicode tokenizer)
- [x] ~~Executor bugs: partial-index targetWhere, TAR checksum, bundle self-inclusion~~ — đã sửa
- [x] ~~Target audit fallback control-plane DB~~ — đã sửa (fail-closed, environment-specific env vars)
- [x] ~~Audit transaction atomicity~~ — đã sửa (audit + approval/job trong một transaction; approval `artifact.package` cũng trong finalize tx)
- [x] ~~Administrator bypass production approval~~ — đã sửa (approval required for ALL actors)
- [x] ~~Idempotency replay trả "started" cho waiting_approval~~ — đã sửa (trả `waiting_approval`)
- [x] ~~db_schema parity false-green khi DB scanner bị skip~~ — đã sửa (fail-closed: `pending` khi DB không đo, không `passed`)
- [x] ~~Lease fencing non-audit executor~~ — đã sửa (executor nhận `LeaseFence`, `assert()` trước mỗi side effect)
- [x] ~~Scoped knowledge index không xóa artifact đã bị xóa~~ — đã sửa (`auditDocs` map evict postings cũ; `scopedToAudit`→`lastScopedAudit`)
- [x] ~~Active-audit concurrency race~~ — đã sửa (partial unique index `audits_active_uidx`)
- [x] ~~Self-approval~~ — đã sửa (requester không approve yêu cầu của chính mình)
- [x] ~~CI migration validation~~ — đã thêm bước `db:migrate` apply trên DB sạch + Docker `--add-host` (chưa từng chạy xanh do lockfile mismatch, đã sửa trong branch này)
- [ ] OTLP ingestion thật (điểm cắm `src/services/telemetry.ts`) → `source: "otlp"`
- [ ] GitHub push thật cho reconstruction bundle (hiện `artifact.package` chỉ package local, chưa push)
- [ ] Artifact object storage (MinIO/S3) — metadata đã sẵn (storageProvider/storageKey/sha256)
- [ ] Docker inspect, Trivy/Syft/Gitleaks binary scanner (Python `auditor/` package, contract JSON chia sẻ)
- [ ] Baseline comparison đầy đủ: Production vs Clean VM (services/ports/env/migrations)
- [ ] Playwright E2E suite
- [ ] OIDC provider thay cho auth nội bộ tối thiểu
- [ ] Markdown/Mermaid/SARIF renderers cho artifact viewer
- [ ] Login rate limit / account lockout / backoff
- [ ] Cookie `Secure` flag cho production
- [ ] Production rules enforcement (backend, không chỉ UI)
- [ ] Tauri desktop distributable: build theo OS matrix, CSP, signing, updater
- [ ] Tauri: bundle `worker/index.js` vào standalone output
- [ ] DB migrations thay vì db:push cho release — migrations đã có và CI đã verify apply, nhưng release pipeline vẫn dùng `db:push`; chuyển hẳn sang `db:migrate` cho production deploy
