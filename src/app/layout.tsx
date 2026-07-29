import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { AppChrome } from "@/components/shell/app-chrome";

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter", weight: ["400", "500", "600", "700"] });
const space = Space_Grotesk({ subsets: ["latin", "vietnamese"], variable: "--font-space", weight: ["500", "600", "700"] });
const jetbrains = JetBrains_Mono({ subsets: ["latin", "vietnamese"], variable: "--font-jet", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "AI Agent OS — Control Plane",
  description:
    "Audit · Architecture · Recovery · Functional Parity. Independent AI System Auditor control plane for the Hermes agent runtime.",
};

export const viewport: Viewport = {
  themeColor: "#020713",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className="dark">
      <body className={`${inter.variable} ${space.variable} ${jetbrains.variable} circuit-bg min-h-screen font-sans text-ink antialiased`}>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
