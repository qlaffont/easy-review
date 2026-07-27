import { z } from "zod";

const serverEnvSchema = z.object({
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
});

export type GithubServerEnv = z.infer<typeof serverEnvSchema>;

let cached: GithubServerEnv | null = null;

/** Validated server-only GitHub OAuth secrets. Never import from client code. */
export function getGithubServerEnv(): GithubServerEnv {
    if (cached) {
        return cached;
    }

    const parsed = serverEnvSchema.safeParse({
        GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
        GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    });

    if (!parsed.success) {
        const fields = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
        throw new Error(
            `Missing or invalid server environment: ${fields}. See README for GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.`,
        );
    }

    cached = parsed.data;
    return cached;
}
