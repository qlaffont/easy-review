import type { GithubClient, GithubViewer } from "#/lib/session/ports.ts";
import type { Repository } from "#/lib/session/types.ts";

import { EasyReviewError, unauthorized } from "#/lib/session/errors.ts";

export type FakeGithub = GithubClient & {
    /** Register a token GitHub will accept, together with the account behind it. */
    addAccount(token: string, viewer?: Partial<GithubViewer>): GithubViewer;
    /** Make a repository visible to a token. */
    addRepository(token: string, nameWithOwner: string, repository?: Partial<Repository>): Repository;
    /** Revoke a token so the next call with it fails as unauthorized. */
    revokeAccount(token: string): void;
    /** Make the next call fail, whatever the token. */
    failNextWith(error: EasyReviewError): void;
    /** Hold the next call in flight until the returned function is called. */
    deferNext(): () => void;
    /** Names of the client methods called so far, in order. */
    calls: Array<string>;
};

export function createFakeGithub(): FakeGithub {
    const accounts = new Map<string, GithubViewer>();
    const repositoriesByToken = new Map<string, Array<Repository>>();
    const calls: Array<string> = [];
    let forcedError: EasyReviewError | null = null;
    let gate: Promise<void> | null = null;

    function authenticate(token: string): GithubViewer {
        if (forcedError) {
            const error = forcedError;
            forcedError = null;
            throw error;
        }

        const viewer = accounts.get(token);

        if (!viewer) {
            throw unauthorized();
        }

        return viewer;
    }

    async function respond<TResult>(method: string, produce: () => TResult): Promise<TResult> {
        calls.push(method);
        const pending = gate;
        gate = null;

        if (pending) {
            await pending;
        }

        return produce();
    }

    return {
        calls,
        addAccount(token, viewer) {
            const account: GithubViewer = {
                login: viewer?.login ?? "octocat",
                name: viewer?.name ?? "The Octocat",
                avatarUrl: viewer?.avatarUrl ?? null,
            };
            accounts.set(token, account);
            return account;
        },
        addRepository(token, nameWithOwner, repository) {
            const [owner = "", name = ""] = nameWithOwner.split("/");
            const entry: Repository = {
                nameWithOwner,
                owner,
                name,
                isPrivate: repository?.isPrivate ?? false,
                isArchived: repository?.isArchived ?? false,
                pushedAt: repository?.pushedAt ?? null,
            };

            repositoriesByToken.set(token, [...(repositoriesByToken.get(token) ?? []), entry]);
            return entry;
        },
        revokeAccount(token) {
            accounts.delete(token);
            repositoriesByToken.delete(token);
        },
        failNextWith(error) {
            forcedError = error;
        },
        deferNext() {
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            gate = held;

            return () => {
                if (gate === held) {
                    gate = null;
                }
                release();
            };
        },
        getViewer(token) {
            return respond("getViewer", () => authenticate(token));
        },
        listRepositories(token) {
            return respond("listRepositories", () => {
                authenticate(token);
                return repositoriesByToken.get(token) ?? [];
            });
        },
    };
}
