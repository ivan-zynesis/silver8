# Tasks — dashboard-mvp

- [ ] `apps/dashboard` package: Vite + React + TS scaffolding
- [ ] `vite.config.ts` with `base: '/dashboard/'` and dev proxy
- [ ] `index.html`, `main.tsx`, `App.tsx`
- [ ] API layer: `useStatus()` polling hook + `useBookSubscription()` WS hook
- [ ] Components: SymbolPicker, StatusPanel, BookTicker
- [ ] Minimal CSS for legibility
- [ ] `apps/hub` adds `@fastify/static` registration, serves `apps/dashboard/dist` at `/dashboard`
- [ ] Update Dockerfile to copy dashboard dist into runtime image
- [ ] Update docker-compose volume / env if needed
- [ ] turbo.json: dashboard build runs before hub build
- [ ] Smoke verify: `pnpm build && pnpm start:monolith`, open /dashboard in browser
