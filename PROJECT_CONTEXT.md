# EngMath Grad Exams

## Project Purpose
EngMath Grad Exams is a long-term project for organizing engineering mathematics graduate entrance exam past papers, solution-related data, and database-backed study/reference workflows.

## Current Stack
- Frontend/web app: Next.js under `web/`.
- Runtime: Node.js `>=24.15.0`, npm `>=11.12.1` as declared in `web/package.json`.
- Database direction: MySQL-compatible access through `mysql2`.
- Server/domain code: `web/server/` plus top-level `server/database/` SQL schema/data files.

## Migration Notes
- Migrated from OneDrive path: `C:\Users\wje34\OneDrive\文件\New project 2`.
- New local path: `C:\Users\wje34\Desktop\engmath-grad-exams`.
- Migration used a whitelist copy to avoid OneDrive-heavy dependency/cache folders.
- Original OneDrive project should be kept as a temporary backup until the new copy is verified.

## Excluded During Migration
- Root `node_modules/`.
- `frontend/`, which appeared to only contain `node_modules/`.
- `web/node_modules/`.
- `web/.next/`.
- `node-v24.15.0-x64.msi`.

## Important Practices
- Do not commit `.env`, `.env.*`, `node_modules/`, `.next/`, logs, or generated build/cache output.
- Keep long-term or important database/key data outside transient development folders.
- Use the display name `EngMath Grad Exams`; use `engmath-grad-exams` for folder/repo/package naming.

## Setup After Migration
From the new project path:

```powershell
cd C:\Users\wje34\Desktop\engmath-grad-exams\web
npm install
npm run dev
```

## Next Tasks
- Verify Git status in the new path.
- Update `.gitignore` to include `.next`, `.env*`, and logs.
- Reinstall dependencies under `web/`.
- Confirm the app can start from the new desktop location.
- Later, push to GitHub before considering Codespaces.
