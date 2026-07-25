## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles mapped to `Status:` lines in issue files. See `docs/agents/triage-labels.md`.

Skills live under `.agents/skills/`. Install more with `bunx skills add <owner/repo@skill> -y`.

### Design & visual craft

- **frontend-design** — Core design principles and anti-patterns. Start here for any new UI.
- **design-an-interface** — Structure screens before building (IA, layout, flows).
- **emil-design-eng** — Design-engineering craft (spacing, typography, component polish).
- **impeccable** — Audit, polish, critique, delight, animate, optimize admin/dashboard UI. Sub-commands: `audit`, `polish`, `craft`, `shape`, etc.
- **prototype** — Explore UI variants on a route before committing (`UI.md` for visual prototypes).
- **web-design-guidelines** — Vercel web design quality checklist.

### Component library

- **shadcn** — Install and compose shadcn/ui components (Tailwind v4).
- **improve** — shadcn/ui improvement and audit playbook.

### Animation & motion

- **animate** — Purposeful micro-interactions and motion (respects `prefers-reduced-motion`).
- **motion-react** — Motion (Framer Motion) patterns for React.
- **gsap-react** — GSAP animation patterns for React.
- **tailwindcss-animations** — Tailwind-native animation utilities.
- **css-native** — CSS-only animation principles (GPU-friendly).
- **vercel-react-view-transitions** — View transitions between routes and shared elements.

### Responsive & accessibility

- **responsive-design** — Breakpoints, fluid layouts, container queries.
- **accessibility** — WCAG patterns and a11y fixes for web UI.

### Performance & rendering

- **vercel-react-best-practices** — React rendering, bundle, and data-fetch performance.

### TanStack stack

- **tanstack-start-best-practices** — TanStack Start (SSR, server functions, API routes, auth).
- **tanstack-router-best-practices** — File routes, loaders, search params, code splitting.
- **tanstack-query-best-practices** — Caching, mutations, prefetch, SSR dehydration.
- **tanstack-table** — Data tables (sorting, filtering, pagination).
- **tanstack-form** — Form state, validation, field arrays.

### When to use which

| Task | Skill |
|---|---|
| New page or layout | `design-an-interface` → `frontend-design` → `shadcn` |
| Admin table / list | `tanstack-table` + `shadcn` |
| Forms (send, CRUD) | `tanstack-form` + generated Zod schemas |
| Polish pass on built UI | `impeccable` (`audit` or `polish`) |
| Add motion | `animate` + `motion-react` or `tailwindcss-animations` |
| Route transitions | `vercel-react-view-transitions` |
| Mobile / sidebar layout | `responsive-design` |
| Pre-ship quality check | `accessibility` + `vercel-react-best-practices` |
