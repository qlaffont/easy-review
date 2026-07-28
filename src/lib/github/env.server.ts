import { z } from "zod";

/** GitHub App client IDs start with `Iv` (e.g. `Iv1.…`, `Iv23…`). OAuth Apps use `Ov…`. */
const GITHUB_APP_CLIENT_ID = z
    .string()
    .min(1)
    .refine((value) => value.startsWith("Iv"), {
        message:
            "GITHUB_CLIENT_ID must be a GitHub App (starts with Iv, e.g. Iv1. or Iv23). OAuth Apps (Ov…) are not supported — create a GitHub App at https://github.com/settings/apps",
    });

/** Public app slug from the app settings URL (`github.com/apps/<slug>`). Used for Install App. */
const GITHUB_APP_SLUG = z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i, {
        message: "GITHUB_APP_SLUG must be the GitHub App slug (letters, numbers, hyphens).",
    });

const serverEnvSchema = z.object({
    GITHUB_CLIENT_ID: GITHUB_APP_CLIENT_ID,
    GITHUB_CLIENT_SECRET: z.string().min(1),
    GITHUB_APP_SLUG: GITHUB_APP_SLUG.optional(),
});

export type GithubServerEnv = z.infer<typeof serverEnvSchema>;

let cached: GithubServerEnv | null = null;

/** Validated server-only GitHub App credentials. Never import from client code. */
export function getGithubServerEnv(): GithubServerEnv {
    if (cached) {
        return cached;
    }

    const slugRaw = process.env.GITHUB_APP_SLUG?.trim();
    const parsed = serverEnvSchema.safeParse({
        GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
        GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
        GITHUB_APP_SLUG: slugRaw ? slugRaw : undefined,
    });

    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        if (issue?.path[0] === "GITHUB_CLIENT_ID" && issue.code === "custom") {
            throw new Error(issue.message);
        }
        if (issue?.path[0] === "GITHUB_APP_SLUG") {
            throw new Error(issue.message);
        }
        const fields = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
        throw new Error(
            `Missing or invalid server environment: ${fields}. See docs/github-setup.md for GitHub App Client ID and secret.`,
        );
    }

    cached = parsed.data;
    return cached;
}

/** Install URL for the configured GitHub App, or `null` when `GITHUB_APP_SLUG` is unset. */
export function getGithubAppInstallUrl(): string | null {
    const slug = getGithubServerEnv().GITHUB_APP_SLUG;
    if (!slug) {
        return null;
    }
    return `https://github.com/apps/${slug}/installations/new`;
}

/** Test helper — drop the module cache between cases that change env. */
export function resetGithubServerEnvCache(): void {
    cached = null;
}
