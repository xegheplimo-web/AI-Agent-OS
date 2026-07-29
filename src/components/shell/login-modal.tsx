"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, LogIn, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { NeonButton } from "@/components/ui";
import { isDemoModeClient } from "@/lib/mode-client";

const DEMO_ACCOUNTS = [
  { u: "admin", p: "AgentOS#admin", role: "administrator", tone: "#ffb454" },
  { u: "operator.han", p: "AgentOS#ops", role: "operator", tone: "#37d6ff" },
  { u: "viewer", p: "AgentOS#view", role: "viewer", tone: "#7890aa" },
];

export function LoginModal() {
  const open = useUIStore((s) => s.loginOpen);
  const setOpen = useUIStore((s) => s.setLoginOpen);
  const qc = useQueryClient();
  const [username, setUsername] = useState("operator.han");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: () => {
      setError(null);
      setPassword("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Đăng nhập thất bại"),
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-void/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="glass hud-corner w-full max-w-sm rounded-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl border border-cyan/40 bg-cyan/10">
                  <KeyRound className="size-4.5 text-cyan" />
                </span>
                <div>
                  <div className="font-display text-[15px] font-semibold text-ink">Đăng nhập</div>
                  <div className="font-mono text-[9px] tracking-[0.2em] text-mute uppercase">Control Plane Access</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-mute hover:bg-ink/5 hover:text-ink">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block font-mono text-[9.5px] tracking-widest text-mute uppercase">Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  className="w-full rounded-lg border border-line/60 bg-void/70 px-3 py-2 font-mono text-[12.5px] text-ink focus:border-cyan/50 focus:ring-1 focus:ring-cyan/30 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[9.5px] tracking-widest text-mute uppercase">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && login.mutate()}
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  className="w-full rounded-lg border border-line/60 bg-void/70 px-3 py-2 font-mono text-[12.5px] text-ink placeholder:text-mute/50 focus:border-cyan/50 focus:ring-1 focus:ring-cyan/30 focus:outline-none"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-[11.5px] text-rose">
                  <ShieldAlert className="size-4 shrink-0" /> {error}
                </div>
              )}

              <NeonButton onClick={() => login.mutate()} disabled={login.isPending || !password} className="w-full justify-center">
                <LogIn className="size-3.5" /> {login.isPending ? "Đang xác thực…" : "Đăng nhập"}
              </NeonButton>
            </div>

            {isDemoModeClient() && (
              <div className="mt-4 border-t border-ink/8 pt-3">
                <div className="mb-2 font-mono text-[9px] tracking-[0.2em] text-mute uppercase">Demo accounts</div>
                <div className="space-y-1.5">
                  {DEMO_ACCOUNTS.map((a) => (
                    <button
                      key={a.u}
                      onClick={() => {
                        setUsername(a.u);
                        setPassword(a.p);
                      }}
                      className="glass-soft flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 font-mono text-[10.5px] transition-colors hover:border-cyan/40"
                    >
                      <span className="text-ink">{a.u}</span>
                      <span style={{ color: a.tone }}>{a.role}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
