# Connect a GitHub App

Easy Review signs you in with a **GitHub App** and calls the API on your behalf.

| | |
|---|---|
| Create under | [Developer settings → **GitHub Apps**](https://github.com/settings/apps) |
| Client ID | Starts with `Iv` (e.g. `Iv1.…` or `Iv23…`) |
| Not supported | **OAuth Apps** (Client ID starts with `Ov…`) |

Permissions are set on the app (not classic OAuth scopes). After changing permissions, reinstall / re-authorize.

**Organization repos only appear after the app is installed on that org.** Signing in is not enough — membership alone does not grant the app access.

---

## 1. Create the GitHub App

1. Open [GitHub → Settings → Developer settings → GitHub Apps](https://github.com/settings/apps).
2. Click **New GitHub App**.
3. Fill:

| Field | Local development | Production |
|---|---|---|
| **GitHub App name** | e.g. `Easy Review local` (must be unique on GitHub) | e.g. `Easy Review` |
| **Homepage URL** | `http://localhost:3000` | `https://your-domain.example` |
| **Callback URL** | `http://localhost:3000/api/auth/github/callback` | `https://your-domain.example/api/auth/github/callback` |
| **Expire user authorization tokens** | Recommended: checked (8h access + 6mo refresh; Easy Review renews automatically) | Checked |
| **Request user authorization (OAuth) during installation** | Recommended: checked | Checked |
| **Webhook → Active** | Uncheck for local solo use (Easy Review does not need webhooks) | Optional |
| **Where can this GitHub App be installed?** | **Any account** if you need org repos (required to install on orgs). **Only on this account** = personal repos only | As needed |

4. Under **Permissions**, set at least:

| Permission | Access | Why |
|---|---|---|
| **Repository → Contents** | Read and write | Diffs, apply suggestions, media uploads |
| **Repository → Pull requests** | Read and write | Inbox, reviews, merge/close |
| **Repository → Issues** | Read and write | Comments, labels, assignees, reactions |
| **Repository → Checks** | Read-only | Check runs / Actions |
| **Repository → Commit statuses** | Read-only | Legacy CI statuses |
| **Repository → Metadata** | Read-only | Required by GitHub |
| **Organization → Members** | Read-only | Team names on review requests |

5. Click **Create GitHub App**.

---

## 2. Copy credentials into `.env`

On the app’s settings page:

1. Copy **Client ID** (must start with `Iv`).
2. Under **Client secrets**, generate a secret and copy it (shown once).

```bash
cp .env.example .env
```

```env
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_APP_SLUG=your-app-slug
```

| Variable | Where it comes from |
|---|---|
| `GITHUB_CLIENT_ID` | App settings → **Client ID** (`Iv…`) |
| `GITHUB_CLIENT_SECRET` | App settings → **Client secrets** |
| `GITHUB_APP_SLUG` | Public page URL: `github.com/apps/<slug>` (also in the app settings URL). Powers **Install GitHub App** on the sign-in page. |

These are **server-only** — never use a `VITE_` prefix. Restart after editing:

```bash
pnpm dev
```

### Session encryption (optional)

When **Expire user authorization tokens** is enabled on your GitHub App, Easy Review stores the refresh token in an **AES-256-GCM encrypted httpOnly cookie** (no database). The access token is renewed automatically before it expires (~every 8 hours).

Set `GITHUB_SESSION_SECRET` to a long random string (32+ characters) so refresh tokens are not encrypted with the OAuth client secret. If unset, the client secret is used as a fallback.

---

## 3. Install the app (personal + orgs), then sign in

1. On Easy Review’s sign-in page, click **Install GitHub App** (or open **Install App** on the GitHub app settings page).
2. Install on **your user account** (pick the personal repos you care about, or all).
3. Install again on **each organization** whose repos you want in Easy Review:
   - Choose the org → **Only select repositories** (or all) → confirm.
   - If the app was created as **Only on this account**, change it to **Any account** first, or you cannot install on orgs.
   - If the org restricts third-party apps, an **org owner** must approve the install (org → Settings → GitHub Apps / Third-party access).
4. Open [http://localhost:3000](http://localhost:3000) → **Sign in with GitHub** and authorize.
5. Open **Choose repositories** and refresh. You should see repos from every account/org where the app is installed.

### Still missing org repos?

- [ ] App installability is **Any account**
- [ ] App is **installed on that org** (not only on your user)
- [ ] The specific repos were selected during install (or “All repositories”)
- [ ] Org policy approved the app (if required)
- [ ] Signed out and signed in again after installing
- [ ] Clicked refresh in the repo picker

Install URL pattern: `https://github.com/apps/<your-app-slug>/installations/new`

---

## Checklist

- [ ] Created under **GitHub Apps**, not OAuth Apps  
- [ ] Client ID starts with `Iv`  
- [ ] Callback URL is `…/api/auth/github/callback` and matches the origin you use  
- [ ] Permissions above are set (especially **Contents: Read and write**)  
- [ ] Installability is **Any account** if you need org repos  
- [ ] App **installed** on your user **and** each org you use  
- [ ] `.env` has `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` + `GITHUB_APP_SLUG`  
- [ ] Dev server restarted after editing `.env`

## See also

- [auth.md](./auth.md) — sign-in flow, auto-reconnect, return URL, sign out
- [inbox.md](./inbox.md) — triage board behavior after you are signed in  
