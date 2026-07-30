# AI Agent OS ΓÇö Push Workflow

Quy tr├¼nh ─æß║⌐y code l├¬n GitHub. L├ám theo c├íc b╞░ß╗¢c theo thß╗⌐ tß╗▒.

## 1. Kiß╗âm tra trß║íng th├íi

```bash
git status
git remote -v
git branch --show-current
```

X├íc nhß║¡n:
- Branch ─æ├║ng (`audit/current-state` hoß║╖c branch ─æang l├ám viß╗çc)
- Remote ─æ├║ng (`origin ΓåÆ https://github.com/xegheplimo-web/AI-Agent-OS.git`)
- Kh├┤ng c├│ file `.env` trong untracked (chß╗ë `.env.example` ─æ╞░ß╗úc track)

## 2. Scan secret tr╞░ß╗¢c khi commit

```bash
# Grep nhanh pattern secret thß║¡t (kh├┤ng phß║úi placeholder change-me)
rg -i "(api_key|secret_key|private_key|BEGIN RSA|BEGIN PRIVATE|ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{20,})" src/ scripts/ tests/ --glob '!*.example'
```

Quy tß║»c:
- `change-me-*` trong `.env.example` v├á `docker-compose.yml` ΓåÆ **OK** (placeholder, kh├┤ng phß║úi secret thß║¡t)
- `hashPassword("AgentOS#admin")` trong `seed.ts` ΓåÆ **OK** (demo seed, hash bß║▒ng scrypt)
- Pattern `BEGIN PRIVATE KEY` trong `scanners.ts` ΓåÆ **OK** (redaction regex, kh├┤ng phß║úi key thß║¡t)
- Bß║Ñt kß╗│ match n├áo kh├íc ΓåÆ **Dß╗¬NG**, kiß╗âm tra thß╗º c├┤ng tr╞░ß╗¢c khi commit

## 3. Stage thay ─æß╗òi

```bash
# Stage tß║Ñt cß║ú: x├│a file c┼⌐ + th├¬m file mß╗¢i + sß╗¡a file
git add -A

# Hoß║╖c stage c├│ chß╗ìn lß╗ìc:
git add src/ tests/ scripts/ Dockerfile docker-compose.yml ...
git rm <files ─æ├ú x├│a>
```

## 4. Kiß╗âm tra diff tr╞░ß╗¢c khi commit

```bash
git diff --cached --stat          # tß╗òng quan
git diff --cached --name-status   # file-level: A/M/D
```

X├íc nhß║¡n:
- Sß╗æ file th├¬m/x├│a/sß╗¡a ─æ├║ng nh╞░ mong ─æß╗úi
- Kh├┤ng c├│ file `.env` trong staged
- Kh├┤ng c├│ `node_modules/`, `.next/`, `data/` (─æ├ú exclude trong .gitignore)

## 5. Commit

```bash
git commit -m "$(cat <<'EOF'
<m├┤ tß║ú ngß║»n gß╗ìn thay ─æß╗òi>

<chi tiß║┐t th├¬m nß║┐u cß║ºn>

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

## 6. Push

```bash
# Push l├¬n branch hiß╗çn tß║íi
git push origin <branch>

# Hoß║╖c push branch mß╗¢i + set upstream
git push -u origin <new-branch>
```

## 7. Tß║ío PR (nß║┐u cß║ºn)

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

## L╞░u ├╜ quan trß╗ìng

- **`.env` kh├┤ng bao giß╗¥ commit** ΓÇö `.gitignore` ─æ├ú exclude, chß╗ë track `.env.example`
- **`package-lock.json` phß║úi commit** ΓÇö `.gitignore` c├│ `!package-lock.json` ─æß╗â override
- **`node_modules/`, `.next/`, `data/`** ─æ├ú exclude trong `.gitignore`
- **Secret thß║¡t** (GitHub token, API key, SSH key) kh├┤ng ─æ╞░ß╗úc ph├⌐p trong code ΓÇö d├╣ng env var
- **Pre-commit hooks** nß║┐u c├│ sß║╜ chß║íy tß╗▒ ─æß╗Öng; nß║┐u sß╗¡a file, `git add` lß║íi rß╗ôi commit lß║íi

## Cß║Ñu tr├║c repo hiß╗çn tß║íi

```
AI-Agent-OS/
Γö£ΓöÇΓöÇ src/                    # Next.js control plane (App Router)
Γöé   Γö£ΓöÇΓöÇ app/api/            # API routes (audits, findings, jobs, approvals, ...)
Γöé   Γö£ΓöÇΓöÇ db/                 # Drizzle ORM schema + seed
Γöé   Γö£ΓöÇΓöÇ lib/                # auth, contracts (Zod), types, utils
Γöé   Γö£ΓöÇΓöÇ services/           # audit engine, jobs queue, telemetry, worker
Γöé   ΓööΓöÇΓöÇ worker/             # external worker process
Γö£ΓöÇΓöÇ tests/                  # vitest unit tests
Γö£ΓöÇΓöÇ scripts/                # verify-real-engine.ts, verify-worker.ts
Γö£ΓöÇΓöÇ src-tauri/              # Tauri desktop shell (Rust)
Γö£ΓöÇΓöÇ .github/workflows/ci.yml
Γö£ΓöÇΓöÇ Dockerfile + docker-compose.yml
Γö£ΓöÇΓöÇ package.json + tsconfig.json + vitest.config.ts
ΓööΓöÇΓöÇ .env.example
```
