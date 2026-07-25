import { faker } from "@faker-js/faker";

import type { GithubClient } from "#/lib/session/ports.ts";
import type {
    CheckRun,
    CheckState,
    Label,
    MergeableState,
    PullRequestSummary,
    ReviewState,
} from "#/lib/session/types.ts";

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

const LABELS: Array<Label> = [
    { name: "bug", color: "d73a4a" },
    { name: "enhancement", color: "a2eeef" },
    { name: "needs-discussion", color: "d4c5f9" },
    { name: "infra", color: "0e8a16" },
];

const CHECK_NAMES = ["build", "unit tests", "typecheck", "lint", "e2e", "deploy preview"];

function checkRuns(rollup: CheckState): Array<CheckRun> {
    if (rollup === "none") {
        return [];
    }

    return faker.helpers.arrayElements(CHECK_NAMES, { min: 2, max: 5 }).map((name, index) => ({
        name,
        // The rollup is whatever the worst run said, so make the first run tell that story.
        state: index === 0 ? rollup : faker.helpers.arrayElement<CheckState>(["success", "success", "pending"]),
        url: `https://ci.example.com/${name.replace(/\s+/g, "-")}`,
    }));
}

function body(): string {
    const [why = "", what = ""] = faker.lorem.paragraphs(2).split("\n");

    return [
        "## Why",
        "",
        why,
        "",
        "## What changed",
        "",
        `- ${faker.hacker.phrase()}`,
        `- ${faker.hacker.phrase()}`,
        "",
        what,
        "",
        "```ts",
        `const ${faker.hacker.noun().replace(/\W/g, "")} = ${faker.number.int({ min: 1, max: 99 })};`,
        "```",
    ].join("\n");
}

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
        const checks = faker.helpers.arrayElement(CHECKS);

        github.addPullRequest(DEV_TOKEN, {
            repository,
            number,
            title: faker.git.commitMessage(),
            author: faker.internet.username().toLowerCase(),
            updatedAt: updatedAt.toISOString(),
            createdAt: faker.date.recent({ days: 30, refDate: updatedAt }).toISOString(),
            checks,
            additions: faker.number.int({ min: 1, max: 900 }),
            deletions: faker.number.int({ min: 0, max: 400 }),
            changedFiles: faker.number.int({ min: 1, max: 30 }),
            commentCount: faker.number.int({ min: 0, max: 12 }),
            reviewers: [
                { login: faker.internet.username().toLowerCase(), state: faker.helpers.arrayElement(REVIEW_STATES) },
            ],
            body: number % 7 === 0 ? "" : body(),
            headSha: faker.git.commitSha(),
            labels: faker.helpers.arrayElements(LABELS, { min: 0, max: 3 }),
            assignees: faker.helpers.maybe(() => [faker.internet.username().toLowerCase()]) ?? [],
            checkRuns: checkRuns(checks),
            mergeable: faker.helpers.arrayElement<MergeableState>([
                "mergeable",
                "mergeable",
                "mergeable",
                "conflicting",
            ]),
            ...shape,
            ...(shape.state === "merged" ? { mergedAt: updatedAt.toISOString() } : {}),
        });
    }

    return github;
}
