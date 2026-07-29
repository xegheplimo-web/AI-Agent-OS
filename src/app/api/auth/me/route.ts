import { getActor } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ user: null }, { status: 200 });
  return Response.json({
    user: {
      username: actor.id,
      displayName: actor.displayName,
      role: actor.role,
      permissions: actor.permissions,
    },
  });
}
