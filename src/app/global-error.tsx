"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="vi">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "#020713",
          color: "#e9f6ff",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700 }}>Control Plane gặp lỗi nghiêm trọng</div>
        <p style={{ margin: 0, maxWidth: 480, textAlign: "center", color: "#7890aa", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
          {error.message || "Unexpected error"}
        </p>
        <button
          onClick={reset}
          style={{
            border: "1px solid rgba(55,214,255,0.4)",
            background: "rgba(55,214,255,0.12)",
            color: "#37d6ff",
            borderRadius: 10,
            padding: "10px 18px",
            fontSize: 12,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Tải lại ứng dụng
        </button>
      </body>
    </html>
  );
}
