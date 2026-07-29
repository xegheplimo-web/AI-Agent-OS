"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { QueryProvider } from "@/components/query-provider";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CommandPalette } from "@/components/shell/command-palette";
import { LoginModal } from "@/components/shell/login-modal";
import { TopHeader } from "@/components/shell/top-header";

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <QueryProvider>
      {/* ambient vignette */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.5)_100%)]" />
      <AppSidebar />
      <TopHeader />
      <main className="relative z-10 min-h-screen pt-16 pl-60">
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.997 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-[1720px] px-5 pt-4 pb-6"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
      <CommandPalette />
      <LoginModal />
    </QueryProvider>
  );
}
