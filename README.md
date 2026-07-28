# Easy Review

TanStack Start app for GitHub pull-request triage and review. The browser talks to this app’s server; the server proxies GitHub API calls and holds the OAuth client secret.

## Getting Started

Requires **Node.js 24 LTS** (see `.node-version`) and **pnpm**.

```bash
pnpm install
cp .env.example .env
# fill GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and use **Sign in with GitHub**.

### Fixture mode (no OAuth)

```bash
VITE_FAKE_GITHUB=1 pnpm dev
```

## GitHub OAuth setup

Use a classic **OAuth App** (Client ID starts with `Iv1.`). A GitHub App’s user-to-server OAuth credentials (`Ov23…`) only see repositories where that app is **installed** — which is why org repos often look missing.

1. Create an **OAuth App** under [GitHub Developer settings](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App** (not “GitHub Apps”).
2. Set:
   - **Homepage URL:** `http://localhost:3000` (or your deployed origin)
   - **Authorization callback URL:** `http://localhost:3000/api/auth/github/callback` (same origin + `/api/auth/github/callback` in production)
3. Copy the **Client ID** and generate a **Client secret**.
4. Put them in `.env` (see `.env.example`):

```env
GITHUB_CLIENT_ID=Iv1.xxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxx
```

These variables are **server-only**. Do not use a `VITE_` prefix; the client never receives them.

### Organization repositories

After sign-in, `/user/repos` only returns org repos the token is allowed to see:

- **OAuth App (`Iv1.`):** on the GitHub authorize screen, grant access to each org (or later open [Authorized OAuth Apps](https://github.com/settings/applications) → this app → **Organization access** → **Grant**). Orgs with [OAuth App access restrictions](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data) need an org admin approval.
- **GitHub App (`Ov23…`):** install the app on the org (and select the repos), with permissions for Contents + Pull requests. Prefer switching to an OAuth App for local solo use.

Then sign out / sign in again (or refresh repositories) so a new token is issued with that access.

### Scopes requested

| Scope | Why |
|---|---|
| `repo` | Private repos, PRs, diffs, reviews, merge/close, reactions, apply suggestions |
| `read:user` | Identify the signed-in user |
| `read:org` | Team names on review requests (Inbox + timeline) |

After changing scopes, sign out and **Sign in with GitHub** again so GitHub re-prompts and issues a token with the new set.

### How auth + proxy works

1. Browser → `GET /api/auth/github` → redirect to GitHub authorize.
2. GitHub → `GET /api/auth/github/callback` → server exchanges `code` using **client id + client secret**, stores the access token in an HTTP-only cookie.
3. All forge traffic goes through same-origin routes:
   - `POST /api/github/graphql`
   - `/api/github/*` (REST)
4. The proxy reads the session cookie and adds `Authorization: Bearer …` before calling `https://api.github.com`.

## Building For Production

```bash
pnpm build
node dist/server/index.mjs
```

Set the same env vars on the host. Register the production callback URL on the OAuth App (`https://your-domain/api/auth/github/callback`).

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
