"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Radio, Rss } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { EventDTO } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { Panel } from "@/components/ui";
import { ApiErrorState } from "@/components/feedback";

const SEV_COLOR: Record<string, string> = {
  info: "#37d6ff",
  success: "#20e3a2",
  warning: "#ffb454",
  error: "#ff5f7a",
};

/**
 * Live event stream. Prefers SSE (/api/stream/events); if the stream
 * errors (proxy closes, offline), falls back to React Query polling.
 */
export function EventsFeed({ limit = 14, className }: { limit?: number; className?: string }) {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);

  const events = useQuery({
    queryKey: ["events", limit],
    queryFn: () => api.events(limit),
    refetchInterval: live ? false : 5000,
  });

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/stream/events");
      es.onopen = () => setLive(true);
      es.onmessage = (msg) => {
        try {
          const dto = JSON.parse(msg.data) as EventDTO;
          qc.setQueryData<EventDTO[]>(["events", limit], (old) => {
            const next = [dto, ...(old ?? [])];
            const seen = new Set<number>();
            return next.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).slice(0, limit);
          });
          qc.setQueryData<EventDTO[]>(["events", 6], (old) => {
            const next = [dto, ...(old ?? [])];
            const seen = new Set<number>();
            return next.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).slice(0, 6);
          });
        } catch {
          /* malformed frame — ignore */
        }
      };
      es.onerror = () => {
        setLive(false);
        es?.close();
      };
    } catch {
      setLive(false);
    }
    return () => {
      es?.close();
      setLive(false);
    };
  }, [qc, limit]);

  return (
    <Panel
      title="Live Event Stream"
      icon={Radio}
      tone="cyan"
      pad={false}
      className={className}
      bodyClassName="max-h-[420px] overflow-y-auto"
      right={
        <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-widest uppercase" style={{ color: live ? "#20e3a2" : "#ffb454" }}>
          {live ? (
            <>
              <span className="size-1.5 animate-blink rounded-full bg-mint shadow-[0_0_5px_#20e3a2]" /> SSE live
            </>
          ) : (
            <>
              <Rss className="size-3" /> polling
            </>
          )}
        </span>
      }
    >
      {events.isError ? (
        <ApiErrorState error={events.error} onRetry={() => events.refetch()} />
      ) : (
        <AnimatePresence initial={false}>
          {events.data?.map((e, i) => (
            <motion.div
              key={e.id}
              initial={i === 0 ? { opacity: 0, y: -10, backgroundColor: "rgba(55,214,255,0.09)" } : false}
              animate={{ opacity: 1, y: 0, backgroundColor: "rgba(55,214,255,0)" }}
              transition={{ duration: 0.6 }}
              className="flex items-start gap-2.5 border-b border-ink/5 px-4 py-2.5 last:border-0"
            >
              <span
                className="mt-1 size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: SEV_COLOR[e.severity], boxShadow: `0 0 6px ${SEV_COLOR[e.severity]}` }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] leading-snug text-ink/90">{e.message}</div>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[9.5px] text-mute">
                  <span className="text-cyan/80">{e.source}</span>
                  <span className="text-mute/50">·</span>
                  <span>{e.type}</span>
                  <span className="text-mute/50">·</span>
                  <span>{timeAgo(e.createdAt)}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      )}
      {events.isLoading && (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shimmer h-8 rounded-lg" />
          ))}
        </div>
      )}
    </Panel>
  );
}
