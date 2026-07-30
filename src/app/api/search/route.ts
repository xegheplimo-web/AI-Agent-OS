import { desc, eq, ilike, or, inArray } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, audits, components, findings, jobs, settings } from "@/db/schema";
import type { SearchResult } from "@/lib/contracts";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface InvertedIndex {
  docCount: number;
  termCount: number;
  docLengths: Record<number, number>;
  postings: Record<string, Array<{ artifactId: number; path: string; tf: number }>>;
}

/** Load the inverted index built by the knowledge.reindex executor.
 *  Returns null when no index exists (reindex hasn't run yet). */
async function loadInvertedIndex(): Promise<InvertedIndex | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, "knowledge.invertedIndex")).limit(1);
  if (!rows.length) return null;
  return rows[0].value as InvertedIndex;
}

/** Tokenize a query the same way the indexer does — lowercase, split on
 *  non-word chars, keep tokens 2-40 chars. Uses Unicode property escapes
 *  (\p{L} for letters, \p{N} for numbers) so Vietnamese diacritics and
 *  CJK characters are preserved — the previous `[^a-z0-9_]` regex stripped
 *  all non-ASCII characters, making Vietnamese search impossible. */
function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && t.length <= 40);
}

/** Search the inverted index for artifacts matching the query tokens.
 *  Returns artifact IDs ranked by term frequency (simple TF scoring —
 *  enough to surface relevant artifacts without a full BM25 implementation). */
async function searchInvertedIndex(q: string): Promise<Array<{ id: number; path: string; score: number }>> {
  const index = await loadInvertedIndex();
  if (!index) return [];

  const tokens = tokenizeQuery(q);
  if (!tokens.length) return [];

  const scores = new Map<number, { path: string; score: number }>();
  for (const tok of tokens) {
    const postings = index.postings[tok];
    if (!postings) continue;
    for (const p of postings) {
      const existing = scores.get(p.artifactId);
      if (existing) {
        existing.score += p.tf;
      } else {
        scores.set(p.artifactId, { path: p.path, score: p.tf });
      }
    }
  }

  return [...scores.entries()]
    .map(([id, { path, score }]) => ({ id, path, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

export async function GET(req: Request) {
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json([]);

  const like = `%${q}%`;

  /* Artifact search: try the inverted index first (built by knowledge.reindex).
     If the index exists and returns matches, use those — they include full-text
     content search, not just title/path ILIKE. Fall back to ILIKE on title/path
     when no index exists or it returns no matches. */
  const indexHits = await searchInvertedIndex(q);
  let artifactRows: Array<{ id: number; title: string; path: string }>;

  if (indexHits.length) {
    const ids = indexHits.map((h) => h.id);
    const rows = await db
      .select({ id: artifacts.id, title: artifacts.title, path: artifacts.path })
      .from(artifacts)
      .where(inArray(artifacts.id, ids));
    // Preserve index ranking order
    const byId = new Map(rows.map((r) => [r.id, r]));
    artifactRows = indexHits.map((h) => byId.get(h.id)).filter((r): r is NonNullable<typeof r> => !!r);
  } else {
    artifactRows = await db
      .select({ id: artifacts.id, title: artifacts.title, path: artifacts.path })
      .from(artifacts)
      .where(or(ilike(artifacts.title, like), ilike(artifacts.path, like)))
      .limit(5);
  }

  const [comps, auditRows, findingRows, jobRows] = await Promise.all([
    db.select().from(components).where(or(ilike(components.name, like), ilike(components.role, like))).limit(4),
    db.select().from(audits).where(ilike(audits.name, like)).orderBy(desc(audits.startedAt)).limit(4),
    db.select().from(findings).where(or(ilike(findings.title, like), ilike(findings.component, like))).orderBy(desc(findings.createdAt)).limit(6),
    db.select().from(jobs).where(or(ilike(jobs.type, like), ilike(jobs.target, like))).orderBy(desc(jobs.createdAt)).limit(4),
  ]);

  const results: SearchResult[] = [
    ...comps.map((c) => ({
      group: "component" as const,
      id: c.id,
      title: c.name,
      subtitle: `${c.role} · ${c.status}`,
      href: "/architecture",
    })),
    ...auditRows.map((a) => ({
      group: "audit" as const,
      id: a.id,
      title: a.name,
      subtitle: `${a.status} · score ${a.score ?? "—"} · ${a.environment}`,
      href: "/audit",
    })),
    ...findingRows.map((f) => ({
      group: "finding" as const,
      id: String(f.id),
      title: f.title,
      subtitle: `${f.severity} · ${f.component} · ${f.status}`,
      href: "/audit",
    })),
    ...artifactRows.map((a) => ({
      group: "artifact" as const,
      id: String(a.id),
      title: a.title,
      subtitle: a.path,
      href: `/knowledge?artifact=${a.id}`,
    })),
    ...jobRows.map((j) => ({
      group: "job" as const,
      id: j.id,
      title: `${j.type} → ${j.target}`,
      subtitle: `${j.status} · ${j.progress}%`,
      href: "/observability",
    })),
  ];

  return Response.json(results);
}
