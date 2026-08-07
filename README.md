# Easy Review

TanStack Start app for GitHub pull-request triage and review. The browser talks to this app’s server; the server holds your GitHub App credentials and proxies API calls.

## Getting Started

Requires **Node.js 24 LTS** (see `.node-version`) and **pnpm**.

```bash
pnpm install
cp .env.example .env
# follow docs/github-setup.md — create a GitHub App (Iv…) and paste Client ID + secret
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and use **Sign in with GitHub**.

**Credentials:** see **[docs/github-setup.md](docs/github-setup.md)** — create the GitHub App, set permissions, install it, and what to put in `.env`.

## Documentation

| Doc | Contents |
| --- | --- |
| [CONTEXT.md](CONTEXT.md) | Domain glossary (auth, inbox sections, refresh, notifications) |
| [docs/inbox.md](docs/inbox.md) | Inbox sections, navigation, refresh, notifications, keyboard |
| [docs/auth.md](docs/auth.md) | Sign-in, reconnect vs sign-out, return URL |
| [docs/github-setup.md](docs/github-setup.md) | GitHub App setup and environment variables |

Spec and issue tracker (implementation history): `.scratch/pr-inbox-and-review/`.

### Fixture mode (no GitHub sign-in)

```bash
VITE_FAKE_GITHUB=1 pnpm dev
```

## Building For Production

```bash
pnpm build
node dist/server/index.mjs
```

Set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` on the host and register the production callback URL on the GitHub App (`https://your-domain/api/auth/github/callback`). Details: [docs/github-setup.md](docs/github-setup.md).

## Deploy with Nitro

This project uses Nitro as a generic server adapter, so it can run on any Node-compatible host.

```bash
pnpm build
node dist/server/index.mjs
```

For host-specific presets (Vercel, Netlify, Cloudflare, AWS Lambda, etc.), see https://v3.nitro.build/deploy.

## Shadcn

```bash
pnpm dlx shadcn@latest add button
```

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server on port 3000 |
| `pnpm build` | Production build |
| `pnpm test` | Vitest |
| `pnpm typecheck` | TypeScript |
