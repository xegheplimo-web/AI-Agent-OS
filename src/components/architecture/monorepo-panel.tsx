"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, FolderGit2, FolderOpen, Server } from "lucide-react";
import { useState } from "react";
import { MONOREPO_TREE } from "@/lib/audit-data";
import { cn } from "@/lib/utils";

export function MonorepoPanel() {
  const [open, setOpen] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.5 }}
      className="glass hud-corner absolute bottom-3 left-3 z-20 w-[240px] rounded-xl"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-line/50 px-3 py-2"
      >
        <FolderGit2 className="size-3.5 text-cyan" strokeWidth={2} />
        <span className="font-mono text-[9.5px] tracking-[0.24em] text-ink/85 uppercase">Monorepo Layout</span>
        <ChevronDown className={cn("ml-auto size-3.5 text-mute transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="flex gap-3 p-3">
              <ul className="flex-1 space-y-1">
                {MONOREPO_TREE.map((t, i) => (
                  <motion.li
                    key={t.name}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.35 + i * 0.04 }}
                    className="flex items-center gap-1.5 font-mono text-[10px] text-mute"
                  >
                    <span className="text-azure/60">├─</span>
                    <FolderOpen className="size-3 text-azure" strokeWidth={1.8} />
                    <span className="text-[#a9c6e4]">{t.name}</span>
                  </motion.li>
                ))}
              </ul>
              <div className="flex shrink-0 items-end">
                <div className="relative">
                  <Server className="size-12 text-azure/80" strokeWidth={1} style={{ filter: "drop-shadow(0 0 12px rgba(49,135,255,0.5))" }} />
                  <span className="absolute inset-x-0 -bottom-1 mx-auto h-1 w-10 rounded-full bg-cyan/25 blur-[3px]" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
