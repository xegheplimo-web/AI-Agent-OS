# AI Agent OS — Push Workflow

Quy trình đẩy code lên GitHub. Làm theo các bước theo thứ tự.

## 1. Kiểm tra trạng thái

```bash
git status
git remote -v
git branch --show-current
```

Xác nhận:
- Branch đúng (`audit/current-state` hoặc branch đang làm việc)
- Remote đúng (`origin → https://github.com/xegheplimo-web/AI-Agent-OS.git`)
- Không có file `.env` trong untracked (chỉ `.env.example` được track)

## 2. Scan secret trước khi commit

```bash
# Grep nhanh pattern secret thật (không phải placeholder change-me)
rg -i "(api_key|secret_key|private_key|BEGIN RSA|BEGIN PRIVATE|ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{20,})" src/ scripts/ tests/ --glob '!*.example'
```

Quy tắc:
- `change-me-*` trong `.env.example` và `docker-compose.yml` → **OK** (placeholder, không phải secret thật)
- `hashPassword("AgentOS#admin")` trong `seed.ts` → **OK** (demo seed, hash bằng scrypt)
- Pattern `BEGIN PRIVATE KEY` trong `scanners.ts` → **OK** (redaction regex, không phải key thật)
- Bất kỳ match nào khác → **DỪNG**, kiểm tra thủ công trước khi commit

## 3. Stage thay đổi

```bash
# Stage tất cả: xóa file cũ + thêm file mới + sửa file
git add -A

# Hoặc stage có chọn lọc:
git add src/ tests/ scripts/ Dockerfile docker-compose.yml ...
git rm <files đã xóa>
```

## 4. Kiểm tra diff trước khi commit

```bash
git diff --cached --stat          # tổng quan
git diff --cached --name-status   # file-level: A/M/D
```

Xác nhận:
- Số file thêm/xóa/sửa đúng như mong đợi
- Không có file `.env` trong staged
- Không có `node_modules/`, `.next/`, `data/` (đã exclude trong .gitignore)

## 5. Commit

```bash
git commit -m "$(cat <<'EOF'
<mô tả ngắn gọn thay đổi>

<chi tiết thêm nếu cần>

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

## 6. Push

```bash
# Push lên branch hiện tại
git push origin <branch>

# Hoặc push branch mới + set upstream
git push -u origin <new-branch>
```

## 7. Tạo PR (nếu cần)

```bash
gh pr create --title "title" --body "$(cat <<'EOF'
## Summary
<bullet points>

#### Test plan
<checklist>

Generated with [Devin](https://devin.ai)
EOF
)"
```

## Lưu ý quan trọng

- **`.env` không bao giờ commit** — `.gitignore` đã exclude, chỉ track `.env.example`
- **`package-lock.json` phải commit** — `.gitignore` có `!package-lock.json` để override
- **`node_modules/`, `.next/`, `data/`** đã exclude trong `.gitignore`
- **Secret thật** (GitHub token, API key, SSH key) không được phép trong code — dùng env var
- **Pre-commit hooks** nếu có sẽ chạy tự động; nếu sửa file, `git add` lại rồi commit lại

## Cấu trúc repo hiện tại

```
AI-Agent-OS/
├── src/                    # Next.js control plane (App Router)
│   ├── app/api/            # API routes (audits, findings, jobs, approvals, ...)
│   ├── db/                 # Drizzle ORM schema + seed
│   ├── lib/                # auth, contracts (Zod), types, utils
│   ├── services/           # audit engine, jobs queue, telemetry, worker
│   └── worker/             # external worker process
├── tests/                  # vitest unit tests
├── scripts/                # verify-real-engine.ts, verify-worker.ts
├── src-tauri/              # Tauri desktop shell (Rust)
├── .github/workflows/ci.yml
├── Dockerfile + docker-compose.yml
├── package.json + tsconfig.json + vitest.config.ts
└── .env.example
```
