import { desc, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, audits, components, findings, jobs } from "@/db/schema";
import type { SearchResult } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json([]);

  const like = `%${q}%`;

  const [comps, auditRows, findingRows, artifactRows, jobRows] = await Promise.all([
    db.select().from(components).where(or(ilike(components.name, like), ilike(components.role, like))).limit(4),
    db.select().from(audits).where(ilike(audits.name, like)).orderBy(desc(audits.startedAt)).limit(4),
    db.select().from(findings).where(or(ilike(findings.title, like), ilike(findings.component, like))).orderBy(desc(findings.createdAt)).limit(6),
    db.select().from(artifacts).where(or(ilike(artifacts.title, like), ilike(artifacts.path, like))).limit(5),
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
