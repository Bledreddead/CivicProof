# CivicProof frontend — Cluster Explorer integration

The teammate's Cluster Explorer has been integrated as a separate route without replacing the existing dashboard, report submission, investigation pages, or map component.

## Route
- Existing command centre: `/`
- Incident Cluster Explorer: `/clusters`

The command-centre sidebar now links to Incident Clusters.

## Added files
- `src/app/clusters/page.tsx`
- `src/components/clusters/ClusterExplorer.tsx`
- `src/lib/cluster-api.ts`
- `src/types/cluster.ts`
- `src/styles/cluster-explorer.css`

The global stylesheet import was added to `src/app/layout.tsx`. Cluster Explorer CSS selectors are scoped beneath `.explorer-shell` to avoid affecting the existing dashboard.

## Backend
The Cluster Explorer calls:
- `GET /clusters`
- `GET /clusters/{cluster_id}`
- `POST /reports/{report_id}/cluster`

It reads live API responses; no demo reports or static incident records were added.

By default, the cluster API uses `http://127.0.0.1:8000`. To override it, create `frontend/.env.local` with:

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Use the backend origin only, without `/docs` or a trailing slash. Restart the Next.js dev server after changing this value. The backend must be running and must allow the frontend origin through CORS.

## Run locally
From the `frontend` directory:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000/clusters`.

## Validation note
The integration files and route wiring were added, but a production build could not be completed in this environment because the dependency installation did not finish and the local `next` executable was unavailable. Run `npm.cmd install` and `npm.cmd run build` on the Windows project machine to perform the final build check.
