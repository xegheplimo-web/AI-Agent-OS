import { desc, gt } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { eventDtoSchema } from "@/lib/contracts";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ------------------------------------------------------------------ */
/* Server-Sent Events: streams rows appended to the events table.      */
/* Client falls back to polling if the stream drops.                   */
/* ------------------------------------------------------------------ */

export async function GET(req: Request) {
  /* SSE uses cookies same-origin (EventSource cannot set custom headers),
     so the session cookie is sent automatically. Validate it here — a
     fake cookie passes the Edge middleware presence check but getActor
     will reject it. */
  const auth = await requirePermission(req, "system:read");
  if (auth instanceof Response) return auth;

  const encoder = new TextEncoder();
  let lastId = 0;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      send(`retry: 3000\n\n`);

      const prime = await db.select().from(events).orderBy(desc(events.id)).limit(1);
      lastId = prime.length ? prime[0].id : 0;

      const pollTimer = setInterval(async () => {
        try {
          const rows = await db.select().from(events).where(gt(events.id, lastId)).orderBy(events.id).limit(10);
          for (const r of rows) {
            lastId = r.id;
            const dto = eventDtoSchema.parse({
              id: r.id,
              type: r.type,
              severity: r.severity,
              source: r.source,
              message: r.message,
              createdAt: r.createdAt.toISOString(),
            });
            send(`id: ${r.id}\nevent: ${r.type}\ndata: ${JSON.stringify(dto)}\n\n`);
          }
        } catch {
          /* keep stream alive across transient db errors */
        }
      }, 3000);

      const heartbeat = setInterval(() => send(`: ping ${Date.now()}\n\n`), 15000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
