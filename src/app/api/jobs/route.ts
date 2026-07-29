import { advanceJobsIfDemo, enqueueJob, latestJobs } from "@/services/jobs";
import { getActor, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";
import { createJobSchema } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET() {
  await advanceJobsIfDemo();
  return Response.json(await latestJobs(20));
}

export async function POST(req: Request) {
  const actor = await getActor(req);
  if (!hasPermission(actor, "job:create")) {
    await logAudit({ actor, action: "job.create", resourceType: "job", result: "denied", req });
    return Response.json({ error: "Cần quyền operator (job:create)" }, { status: actor ? 403 : 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  const job = await enqueueJob(parsed.data.type, parsed.data.target, actor);
  return Response.json(job, { status: 201 });
}
