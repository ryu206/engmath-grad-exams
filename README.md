# Engineering Math Bank

工程數學題庫系統目前分成 `web` 與 `server`。

## Folder Structure

```text
web/
  app/                         Next.js App Router
  public/
    prototype/                 早期靜態 HTML prototype
    assets/images/             CSS/UI 固定圖片，例如 logo、背景、icon
    uploads/                   開發階段可公開讀取的上傳圖片根目錄
  package.json                 Node/Next.js 專案設定

server/
  api/                         後端 API 程式預留位置
  database/                    MySQL schema 與測試 SQL
  docs/                        後端流程與路由設計文件
```

## Development

複製環境變數範本並填入本機資料庫連線資訊：

```powershell
Copy-Item web/.env.example web/.env.local
```

進入 `web` 目錄後啟動 Next.js：

```powershell
cd web
npm.cmd run dev
```

預設網址：

```text
http://localhost:3000
```

API health check：

```text
http://localhost:3000/api/health
```

靜態 prototype：

```text
http://localhost:3000/prototype/exams-list.html
```

## Upload Storage

開發階段可先把上傳圖片放在：

```text
web/public/uploads/
```

正式資料庫中的 `attachments.path` 建議存相對路徑，例如：

```text
uploads/questions/2026/05/101/uuid.png
```

CSS 或 UI 固定圖片放在：

```text
web/public/assets/images/
```
