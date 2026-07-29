# Desktop shell (Tauri 2)

## Vì sao không dùng static export

App này có API routes, PostgreSQL, session server-side và SSE stream.
`output: "export"` sẽ xoá toàn bộ những thứ đó, nên **không dùng `frontendDist: ../out`**.

Kiến trúc thực tế (Hướng A):

```text
Tauri shell (Rust)
  ├── spawn  node .next/standalone/server.js   (bundle resource)
  ├── poll   127.0.0.1:3000 tới khi listen
  ├── show   WebView → http://127.0.0.1:3000
  └── kill   server khi đóng cửa sổ
```

Nếu cổng 3000 đã có service khác (dev `npm run dev`, hoặc service cài sẵn),
shell **không spawn thêm** mà attach vào server đang chạy.

## Build

```bash
npm run build          # sinh .next/standalone + .next/static
cargo tauri build      # đóng gói .msi/.nsis/.dmg/.AppImage/.deb
```

`bundle.resources` copy `.next/standalone`, `.next/static`, `public/` vào
`resources/server/` của installer; `main.rs` resolve `server/server.js` từ đó.

## Yêu cầu runtime

- Node.js trên máy đích (hoặc bundle Node sidecar — xem roadmap).
- PostgreSQL đang chạy và `DATABASE_URL` được set. Roadmap: local service
  manager tự kiểm tra/khởi động PostgreSQL trước khi mở WebView.

## Roadmap

- [ ] Node sidecar để không phụ thuộc Node cài sẵn
- [ ] System tray: trạng thái audit, critical findings, pause notifications
- [ ] Local service lifecycle: PostgreSQL → worker → dashboard
- [ ] Auto-update qua tauri-plugin-updater
