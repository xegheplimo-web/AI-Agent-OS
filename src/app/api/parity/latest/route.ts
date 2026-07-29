import { desc } from "drizzle-orm";
import { db } from "@/db";
import { parityReports } from "@/db/schema";
import { advanceIfDemo } from "@/services/audit";
import { parityReportDtoSchema, type ParityReportDTO, type ParityCheckDTO } from "@/lib/contracts";
import { diffParityChecks } from "@/lib/parity";

export const dynamic = "force-dynamic";

export async function GET() {
  await advanceIfDemo();

  const rows = await db.select().from(parityReports).orderBy(desc(parityReports.createdAt)).limit(8);
  if (!rows.length) return Response.json({ error: "No parity reports" }, { status: 404 });

  const latest = rows[0];
  const previous = rows[1];

  const payload: ParityReportDTO = parityReportDtoSchema.parse({
    id: latest.id,
    overallStatus: latest.overallStatus,
    score: latest.score,
    environment: latest.environment,
    checks: latest.checks ?? [],
    gates: latest.gates ?? [],
    createdAt: latest.createdAt.toISOString(),
    history: rows.map((r) => ({
      id: r.id,
      score: r.score,
      overallStatus: r.overallStatus,
      createdAt: r.createdAt.toISOString(),
    })),
    baselineDiff: diffParityChecks(
      (previous?.checks ?? []) as ParityCheckDTO[],
      (latest.checks ?? []) as ParityCheckDTO[],
    ),
  });
  return Response.json(payload);
}
