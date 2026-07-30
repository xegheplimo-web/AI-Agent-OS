"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpenText, Check, Copy, Download, FileCode2, FileJson2, FileText, Fingerprint, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { ARTIFACT_KIND_META } from "@/lib/audit-data";
import { cn, timeAgo } from "@/lib/utils";
import { Chip, GhostButton, Panel, Skeleton, type Tone } from "@/components/ui";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const KIND_ICON: Record<string, typeof FileText> = {
  markdown: FileText,
  sbom: FileJson2,
  runbook: BookOpenText,
  mermaid: FileCode2,
  json: FileJson2,
};

const KIND_TONE: Record<string, Tone> = {
  markdown: "cyan",
  sbom: "violet",
  runbook: "mint",
  mermaid: "azure",
  json: "amber",
};

export function ArtifactBrowser() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string>("all");
  const selectedArtifactId = useUIStore((s) => s.selectedArtifactId);
  const setSelectedArtifact = useUIStore((s) => s.setSelectedArtifact);
  const setSelectedId = (id: number | null) => {
    setChecksum("idle");
    setSelectedArtifact(id);
  };
  const selectedId = selectedArtifactId;
  const [copied, setCopied] = useState(false);
  const [checksum, setChecksum] = useState<"idle" | "checking" | "match" | "mismatch">("idle");

  const artifacts = useQuery({ queryKey: ["artifacts"], queryFn: api.artifacts, refetchInterval: 10000 });
  const detail = useQuery({
    queryKey: ["artifact", selectedId],
    queryFn: () => api.artifact(selectedId!),
    enabled: selectedId != null,
  });

  async function verifyChecksum() {
    if (!detail.data?.content || !detail.data.sha256) return;
    setChecksum("checking");
    const actual = await sha256Hex(detail.data.content);
    setChecksum(actual === detail.data.sha256 ? "match" : "mismatch");
  }

  const kinds = Array.from(new Set(artifacts.data?.map((a) => a.kind) ?? []));
  const filtered = (artifacts.data ?? []).filter(
    (a) =>
      (kind === "all" || a.kind === kind) &&
      (!search || a.title.toLowerCase().includes(search.toLowerCase()) || a.path.toLowerCase().includes(search.toLowerCase()) || a.tags.some((t) => t.includes(search.toLowerCase()))),
  );

  function copyContent() {
    if (!detail.data?.content) return;
    navigator.clipboard.writeText(detail.data.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function download() {
    if (!detail.data?.content) return;
    const blob = new Blob([detail.data.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = detail.data.path.split("/").pop() ?? "artifact.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* list */}
      <Panel
        title="Artifact Library"
        icon={BookOpenText}
        tone="cyan"
        pad={false}
        bodyClassName="p-3"
        right={<span className="font-mono text-[10px] text-mute">{filtered.length} file</span>}
      >
        <div className="mb-2.5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-mute" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm artifact / tag…"
              className="w-full rounded-lg border border-line/60 bg-void/60 py-1.5 pr-3 pl-8 font-mono text-[11px] text-ink placeholder:text-mute/60 focus:border-cyan/50 focus:outline-none"
            />
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <GhostButton active={kind === "all"} onClick={() => setKind("all")}>tất cả</GhostButton>
          {kinds.map((k) => (
            <GhostButton key={k} active={kind === k} onClick={() => setKind(k)}>
              {ARTIFACT_KIND_META[k]?.label ?? k}
            </GhostButton>
          ))}
        </div>

        <div className="max-h-[560px] space-y-1.5 overflow-y-auto pr-0.5">
          {artifacts.isLoading &&
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          {filtered.map((a) => {
            const Icon = KIND_ICON[a.kind] ?? FileText;
            const tone = KIND_TONE[a.kind] ?? "cyan";
            const active = selectedId === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={cn(
                  "glass-soft flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200",
                  active ? "border-cyan/50 shadow-[0_0_18px_rgba(55,214,255,0.18)]" : "hover:border-cyan/30",
                )}
              >
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", KIND_TONE[a.kind] === "violet" ? "border-violet/40 bg-violet/10 text-violet" : KIND_TONE[a.kind] === "mint" ? "border-mint/40 bg-mint/10 text-mint" : KIND_TONE[a.kind] === "amber" ? "border-amber/40 bg-amber/10 text-amber" : KIND_TONE[a.kind] === "azure" ? "border-azure/40 bg-azure/10 text-azure" : "border-cyan/40 bg-cyan/10 text-cyan")}>
                  <Icon className="size-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[12.5px] font-medium text-ink">{a.title}</div>
                  <div className="mt-0.5 truncate font-mono text-[9.5px] text-mute">{a.path}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Chip tone={tone as Tone} className="!px-1 !py-0 text-[8.5px]">{ARTIFACT_KIND_META[a.kind]?.label ?? a.kind}</Chip>
                    <span className="font-mono text-[9px] text-mute">{a.sizeKb}KB · {timeAgo(a.updatedAt)}</span>
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && !artifacts.isLoading && (
            <div className="py-10 text-center font-mono text-[11px] text-mute">Không khớp artifact nào.</div>
          )}
        </div>
      </Panel>

      {/* viewer */}
      <Panel
        title={detail.data ? detail.data.title : "Viewer"}
        icon={FileText}
        tone="violet"
        pad={false}
        bodyClassName="relative flex min-h-[520px] flex-col"
        right={
          detail.data && (
            <div className="flex items-center gap-1.5">
              {detail.data.sha256 && (
                <GhostButton onClick={verifyChecksum} disabled={checksum === "checking"}>
                  <Fingerprint
                    className={cn(
                      "size-3.5",
                      checksum === "match" && "text-mint",
                      checksum === "mismatch" && "text-rose",
                    )}
                  />
                  {checksum === "checking"
                    ? "verifying…"
                    : checksum === "match"
                      ? "sha256 ✓"
                      : checksum === "mismatch"
                        ? "sha256 ✗"
                        : "verify sha256"}
                </GhostButton>
              )}
              <GhostButton onClick={copyContent}>
                {copied ? <Check className="size-3.5 text-mint" /> : <Copy className="size-3.5" />}
                {copied ? "copied" : "copy"}
              </GhostButton>
              <GhostButton onClick={download}>
                <Download className="size-3.5" /> download
              </GhostButton>
            </div>
          )
        }
      >
        <AnimatePresence mode="wait">
          {selectedId == null ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl border border-violet/30 bg-violet/10">
                <BookOpenText className="size-6 text-violet" />
              </span>
              <p className="max-w-xs font-mono text-[11px] leading-relaxed text-mute">
                Chọn một artifact bên trái để xem nội dung tái cấu trúc — README, SBOM, runbook, đồ thị Mermaid, báo cáo parity.
              </p>
            </motion.div>
          ) : detail.isLoading ? (
            <motion.div key="load" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2 p-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-4" />
              ))}
            </motion.div>
          ) : detail.data ? (
            <motion.div key={detail.data.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-line/50 px-4 py-2.5">
                <span className="font-mono text-[10.5px] text-cyan/90">{detail.data.path}</span>
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  {detail.data.mimeType && (
                    <span className="rounded border border-azure/25 bg-azure/8 px-1.5 py-0.5 font-mono text-[9px] text-azure">
                      {detail.data.mimeType}
                    </span>
                  )}
                  {detail.data.sizeBytes != null && (
                    <span className="rounded border border-ink/10 bg-ink/5 px-1.5 py-0.5 font-mono text-[9px] text-mute">
                      {(detail.data.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  )}
                  {detail.data.generator && (
                    <span className="rounded border border-violet/25 bg-violet/8 px-1.5 py-0.5 font-mono text-[9px] text-violet">
                      {detail.data.generator}@{detail.data.generatorVersion}
                    </span>
                  )}
                  {detail.data.tags.map((t) => (
                    <span key={t} className="rounded border border-ink/10 bg-ink/5 px-1.5 py-0.5 font-mono text-[9px] text-mute">#{t}</span>
                  ))}
                </span>
              </div>
              {detail.data.sha256 && (
                <div className="border-b border-line/50 px-4 py-1.5 font-mono text-[9px] text-mute">
                  sha256 <span className="text-cyan/70">{detail.data.sha256}</span>
                  {checksum === "match" && <span className="ml-2 text-mint">· verified ✓ integrity khớp</span>}
                  {checksum === "mismatch" && <span className="ml-2 text-rose">· KHÔNG khớp — artifact có thể bị sửa đổi</span>}
                </div>
              )}
              <div className="max-h-[640px] flex-1 overflow-auto p-4">
                <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[#b8d4ee]">
                  {detail.data.content}
                </pre>
              </div>
            </motion.div>
          ) : (
            <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 items-center justify-center p-10">
              <button onClick={() => setSelectedId(null)} className="flex items-center gap-2 font-mono text-[11px] text-rose">
                <X className="size-4" /> Không tải được artifact
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>
    </div>
  );
}
