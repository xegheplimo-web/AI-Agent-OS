"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, ChevronDown, CircleUserRound, LogIn, LogOut, Search, ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";
import { StatusDot } from "@/components/ui";

const PAGE_TITLES: Record<string, { title: string; sub: string }> = {
  "/": { title: "Overview", sub: "Audit · Architecture · Recovery · Functional Parity" },
  "/architecture": { title: "Architecture", sub: "Runtime topology & component graph" },
  "/audit": { title: "Audit Center", sub: "3-stage audit pipeline · evidence · findings" },
  "/parity": { title: "Parity Center", sub: "Functional parity gates vs baseline" },
  "/observability": { title: "Observability", sub: "Traces · metrics · logs · baggage" },
  "/knowledge": { title: "Knowledge", sub: "Reconstructed artifacts & corpus" },
  "/settings": { title: "Settings", sub: "Production rules & workspace preferences" },
};

const ENVIRONMENTS = [
  { key: "production", tone: "#20e3a2" },
  { key: "staging", tone: "#37d6ff" },
  { key: "development", tone: "#8b5cf6" },
  { key: "local", tone: "#7890aa" },
];

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const SEV_DOT: Record<string, string> = {
  info: "#37d6ff",
  success: "#20e3a2",
  warning: "#ffb454",
  error: "#ff5f7a",
};

const ROLE_TONE: Record<string, string> = {
  administrator: "#ffb454",
  operator: "#37d6ff",
  viewer: "#7890aa",
};

export function TopHeader() {
  const pathname = usePathname();
  const now = useClock();
  const qc = useQueryClient();
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const envRef = useRef<HTMLDivElement>(null);

  const environment = useUIStore((s) => s.environment);
  const setEnvironment = useUIStore((s) => s.setEnvironment);
  const setLoginOpen = useUIStore((s) => s.setLoginOpen);
  const setPaletteOpen = useUIStore((s) => s.setPaletteOpen);

  const events = useQuery({ queryKey: ["events", 6], queryFn: () => api.events(6), refetchInterval: 6000 });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 30000 });

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      setUserOpen(false);
    },
  });

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [setPaletteOpen]);

  const page =
    PAGE_TITLES[pathname] ??
    PAGE_TITLES[Object.keys(PAGE_TITLES).find((k) => k !== "/" && pathname.startsWith(k)) ?? "/"] ??
    PAGE_TITLES["/"];

  const hh = now ? String(now.getUTCHours()).padStart(2, "0") : "--";
  const mm = now ? String(now.getUTCMinutes()).padStart(2, "0") : "--";
  const ss = now ? String(now.getUTCSeconds()).padStart(2, "0") : "--";

  const hasAlerts = events.data?.some((e) => e.severity === "warning" || e.severity === "error");
  const env = ENVIRONMENTS.find((e) => e.key === environment) ?? ENVIRONMENTS[0];
  const user = me.data?.user ?? null;

  return (
    <header className="fixed top-0 right-0 left-60 z-30 flex h-16 items-center gap-4 border-b border-line/50 bg-[#020813]/80 px-6 backdrop-blur-xl">
      <div className="leading-tight">
        <div className="font-display text-[14px] font-semibold tracking-wide text-ink">{page.title}</div>
        <div className="font-mono text-[9.5px] tracking-[0.2em] text-mute uppercase">{page.sub}</div>
      </div>

      <div className="mx-2 h-8 w-px bg-gradient-to-b from-transparent via-line to-transparent" />

      {/* environment switcher */}
      <div className="relative" ref={envRef}>
        <button
          onClick={() => setEnvOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors"
          style={{ borderColor: `${env.tone}50`, background: `${env.tone}12` }}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: env.tone, boxShadow: `0 0 6px ${env.tone}` }} />
          <span className="font-mono text-[10px] font-semibold tracking-[0.16em] uppercase" style={{ color: env.tone }}>
            {env.key}
          </span>
          <ChevronDown className={cn("size-3 text-mute transition-transform", envOpen && "rotate-180")} />
        </button>
        <AnimatePresence>
          {envOpen && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14 }}
              className="glass absolute left-0 mt-2 w-44 overflow-hidden rounded-xl p-1"
            >
              {ENVIRONMENTS.map((e) => (
                <button
                  key={e.key}
                  onClick={() => {
                    setEnvironment(e.key);
                    setEnvOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-mono text-[11px] transition-colors hover:bg-cyan/10",
                    e.key === environment && "bg-cyan/8",
                  )}
                >
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: e.tone }} />
                  <span className="text-ink/90">{e.key}</span>
                  {e.key === environment && <span className="ml-auto text-cyan">●</span>}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        {/* command palette trigger */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="glass-soft flex items-center gap-2 rounded-xl px-3 py-2 text-mute transition-colors hover:border-cyan/40 hover:text-cyan"
        >
          <Search className="size-3.5" />
          <span className="hidden font-mono text-[10px] tracking-wider lg:inline">Tìm kiếm</span>
          <kbd className="hidden rounded border border-ink/15 bg-ink/5 px-1 py-0.5 font-mono text-[8.5px] lg:inline">Ctrl K</kbd>
        </button>

        <div className="glass-soft flex size-9 items-center justify-center rounded-xl text-mint" title="Zero-mutation policy enforced">
          <ShieldCheck className="size-4.5" strokeWidth={2} />
        </div>

        {/* bell */}
        <div className="relative" ref={bellRef}>
          <button
            onClick={() => setBellOpen((v) => !v)}
            className={cn(
              "glass-soft relative flex size-9 items-center justify-center rounded-xl transition-colors",
              bellOpen ? "text-cyan" : "text-mute hover:text-cyan",
            )}
          >
            <Bell className="size-4.5" strokeWidth={2} />
            {hasAlerts && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-amber shadow-[0_0_8px_rgba(255,180,84,0.9)]" />}
          </button>
          <AnimatePresence>
            {bellOpen && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={{ duration: 0.16 }}
                className="glass absolute right-0 mt-2 w-96 overflow-hidden rounded-xl"
              >
                <div className="border-b border-line/50 px-3.5 py-2.5 font-mono text-[10px] tracking-[0.22em] text-mute uppercase">
                  Live event feed
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {events.data?.map((e) => (
                    <div key={e.id} className="flex items-start gap-2.5 border-b border-ink/5 px-3.5 py-2.5 last:border-0">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: SEV_DOT[e.severity], boxShadow: `0 0 6px ${SEV_DOT[e.severity]}` }} />
                      <div className="min-w-0">
                        <div className="truncate text-[12px] text-ink/90">{e.message}</div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-mute">
                          <span className="text-cyan/80">{e.source}</span>·<span>{e.type}</span>·<span>{timeAgo(e.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* user */}
        <div className="relative" ref={userRef}>
          {user ? (
            <button onClick={() => setUserOpen((v) => !v)} className="glass-soft flex items-center gap-2 rounded-xl py-1.5 pr-3 pl-1.5 transition-colors hover:border-cyan/40">
              <CircleUserRound className="size-6 text-azure" strokeWidth={1.6} />
              <div className="leading-tight text-left">
                <div className="text-[11px] font-medium text-ink">{user.displayName}</div>
                <div className="font-mono text-[9px] tracking-wider uppercase" style={{ color: ROLE_TONE[user.role] ?? "#7890aa" }}>
                  {user.username} · {user.role}
                </div>
              </div>
            </button>
          ) : (
            <button
              onClick={() => setLoginOpen(true)}
              className="glass-soft flex items-center gap-2 rounded-xl px-3 py-2 text-mute transition-colors hover:border-cyan/40 hover:text-cyan"
            >
              <LogIn className="size-4" />
              <span className="font-mono text-[11px]">Đăng nhập</span>
            </button>
          )}
          <AnimatePresence>
            {userOpen && user && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.14 }}
                className="glass absolute right-0 mt-2 w-60 overflow-hidden rounded-xl"
              >
                <div className="border-b border-line/50 px-3.5 py-2.5">
                  <div className="text-[12px] font-medium text-ink">{user.displayName}</div>
                  <div className="font-mono text-[9.5px] text-mute">{user.username}</div>
                </div>
                <div className="px-3.5 py-2.5">
                  <div className="mb-1.5 font-mono text-[9px] tracking-widest text-mute uppercase">Permissions</div>
                  <div className="flex flex-wrap gap-1">
                    {(user.permissions ?? []).map((p) => (
                      <span key={p} className="rounded border border-cyan/25 bg-cyan/8 px-1.5 py-0.5 font-mono text-[8.5px] text-cyan">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => logout.mutate()}
                  className="flex w-full items-center gap-2 border-t border-line/50 px-3.5 py-2.5 text-[11.5px] text-mute transition-colors hover:bg-rose/10 hover:text-rose"
                >
                  <LogOut className="size-3.5" /> Đăng xuất
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* clock */}
        <div className="glass-soft flex items-center gap-2 rounded-xl px-3 py-2">
          <StatusDot status="running" pulse />
          <span className="font-mono text-[13px] font-medium tracking-wider text-ink tabular-nums">
            {hh}:{mm}:{ss}
          </span>
          <span className="font-mono text-[10px] tracking-widest text-mute">UTC</span>
        </div>
      </div>
    </header>
  );
}
