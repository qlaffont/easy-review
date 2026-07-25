import { faker } from "@faker-js/faker";

import type { GithubClient } from "#/lib/session/ports.ts";
import type { CheckState, PullRequestSummary, ReviewState } from "#/lib/session/types.ts";

import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";

/** The only token the seeded GitHub accepts. */
export const DEV_TOKEN = "dev";
const DEV_LOGIN = "quentin";

const REPOSITORIES = ["quentin/easy-review", "acme/api", "acme/web", "acme/infra"];
const CHECKS: Array<CheckState> = ["success", "success", "pending", "failure", "none"];
const REVIEW_STATES: Array<ReviewState> = ["approved", "commented", "changes-requested"];

type Shape = Partial<PullRequestSummary>;

const SHAPES: Array<Shape> = [
    { reviewRequests: [DEV_LOGIN] },
    { reviewRequests: [DEV_LOGIN, "hubot"] },
    { author: DEV_LOGIN, reviewDecision: "changes-requested" },
    { author: DEV_LOGIN, reviewDecision: "approved" },
    { author: DEV_LOGIN, reviewDecision: "review-required" },
    { author: DEV_LOGIN, isDraft: true },
    { state: "merged" },
    { reviewers: [{ login: DEV_LOGIN, state: "approved" }] },
    { reviewers: [{ login: DEV_LOGIN, state: "changes-requested" }] },
    {},
];

/**
 * A GitHub replaced by fixtures, wired in only when `VITE_FAKE_GITHUB=1` in development. It
 * exists so the Inbox and review screens can be looked at without handing a real token to a
 * dev server.
 */
export function createSeededGithub(): GithubClient {
    faker.seed(20260725);
    const github = createFakeGithub();
    github.addAccount(DEV_TOKEN, { login: DEV_LOGIN, name: "Quentin" });

    for (const repository of REPOSITORIES) {
        github.addRepository(DEV_TOKEN, repository, {
            isPrivate: repository.startsWith("acme/"),
            pushedAt: faker.date.recent({ days: 10 }).toISOString(),
        });
    }

    for (let number = 1; number <= 48; number++) {
        const shape = SHAPES[number % SHAPES.length] ?? {};
        const repository = REPOSITORIES[number % REPOSITORIES.length] ?? REPOSITORIES[0]!;
        const updatedAt = faker.date.recent({ days: 12 });

        github.addPullRequest(DEV_TOKEN, {
            repository,
            number,
            title: faker.git.commitMessage(),
            author: faker.internet.username().toLowerCase(),
            updatedAt: updatedAt.toISOString(),
            createdAt: faker.date.recent({ days: 30, refDate: updatedAt }).toISOString(),
            checks: faker.helpers.arrayElement(CHECKS),
            additions: faker.number.int({ min: 1, max: 900 }),
            deletions: faker.number.int({ min: 0, max: 400 }),
            changedFiles: faker.number.int({ min: 1, max: 30 }),
            commentCount: faker.number.int({ min: 0, max: 12 }),
            reviewers: [
                { login: faker.internet.username().toLowerCase(), state: faker.helpers.arrayElement(REVIEW_STATES) },
            ],
            ...shape,
            ...(shape.state === "merged" ? { mergedAt: updatedAt.toISOString() } : {}),
        });
    }

    return github;
}
