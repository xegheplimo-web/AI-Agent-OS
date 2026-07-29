"use client";

import { create } from "zustand";

interface FindingsFilter {
  severity: string;
  status: string;
  search: string;
}

interface UIState {
  selectedNodeId: string | null;
  setSelectedNode: (id: string | null) => void;

  selectedAuditId: string | null;
  setSelectedAudit: (id: string | null) => void;

  selectedArtifactId: number | null;
  setSelectedArtifact: (id: number | null) => void;

  findingsFilter: FindingsFilter;
  setFindingsFilter: (f: Partial<FindingsFilter>) => void;

  refreshIntervalMs: number;
  setRefreshInterval: (ms: number) => void;

  environment: string;
  setEnvironment: (env: string) => void;

  loginOpen: boolean;
  setLoginOpen: (open: boolean) => void;

  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedNodeId: null,
  setSelectedNode: (id) => set({ selectedNodeId: id }),

  selectedAuditId: null,
  setSelectedAudit: (id) => set({ selectedAuditId: id }),

  selectedArtifactId: null,
  setSelectedArtifact: (id) => set({ selectedArtifactId: id }),

  findingsFilter: { severity: "all", status: "all", search: "" },
  setFindingsFilter: (f) => set((s) => ({ findingsFilter: { ...s.findingsFilter, ...f } })),

  refreshIntervalMs: 4000,
  setRefreshInterval: (ms) => set({ refreshIntervalMs: ms }),

  environment: "production",
  setEnvironment: (environment) => set({ environment }),

  loginOpen: false,
  setLoginOpen: (loginOpen) => set({ loginOpen }),

  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
