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

import { HUGE_FILE_BYTES } from "#/lib/session/diff-policy.ts";
import { createFakeGithub, type FakeFileInput } from "#/lib/session/testing/fake-github.ts";

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
    { reviewers: [{ login: DEV_LOGIN, state: "approved", reviewId: 101 }] },
    { reviewers: [{ login: DEV_LOGIN, state: "changes-requested", reviewId: 102 }] },
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

    return faker.helpers.arrayElements(CHECK_NAMES, { min: 2, max: 5 }).map((name, index) => {
        const state = index === 0 ? rollup : faker.helpers.arrayElement<CheckState>(["success", "success", "pending"]);
        const seconds = faker.number.int({ min: 4, max: 180 });
        const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;

        return {
            name,
            // The rollup is whatever the worst run said, so make the first run tell that story.
            state,
            url: `https://ci.example.com/${name.replace(/\s+/g, "-")}`,
            summary:
                state === "failure"
                    ? `Failing after ${duration}`
                    : state === "success"
                      ? `Successful in ${duration}`
                      : `Running for ${duration}`,
        };
    });
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
                {
                    login: faker.internet.username().toLowerCase(),
                    state: faker.helpers.arrayElement(REVIEW_STATES),
                    reviewId: number * 10 + 1,
                },
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

        github.setPullRequestFiles(DEV_TOKEN, repository, number, seedFiles(number));

        const authorLogin = shape.author ?? DEV_LOGIN;
        const createdAt = faker.date.recent({ days: 20 }).toISOString();
        github.addTimelineItem(DEV_TOKEN, repository, number, {
            kind: "commit",
            id: `commit-${repository}-${number}`,
            createdAt,
            author: { login: authorLogin, avatarUrl: null },
            messageHeadline: faker.git.commitMessage().slice(0, 72),
            oid: faker.git.commitSha(),
            abbreviatedOid: faker.string.hexadecimal({ length: 7, prefix: "" }).toLowerCase(),
            url: `https://github.com/${repository}/commit/${faker.git.commitSha()}`,
            checkState: checks,
            checkRuns: checkRuns(checks),
            signature:
                number % 3 === 0
                    ? {
                          verified: true,
                          keyId: faker.string.hexadecimal({ length: 16, prefix: "" }).toUpperCase(),
                          signerLogin: authorLogin,
                          signerName: faker.person.fullName(),
                          signerAvatarUrl: null,
                      }
                    : null,
        });
        if (number % 2 === 0) {
            github.addTimelineItem(DEV_TOKEN, repository, number, {
                kind: "assigned",
                id: `assigned-${repository}-${number}`,
                createdAt: faker.date.recent({ days: 18 }).toISOString(),
                actor: { login: authorLogin, avatarUrl: null },
                assignee: authorLogin,
            });
        }
        if (number % 4 === 0) {
            const previousTitle = faker.lorem.sentence({ min: 4, max: 10 });
            github.addTimelineItem(DEV_TOKEN, repository, number, {
                kind: "renamed-title",
                id: `rename-${repository}-${number}`,
                createdAt: faker.date.recent({ days: 14 }).toISOString(),
                actor: { login: authorLogin, avatarUrl: null },
                previousTitle,
                currentTitle: `${previousTitle} [${faker.string.alphanumeric(8)}]`,
            });
        }

        if (number % 5 === 1) {
            github.addReviewThread(DEV_TOKEN, repository, number, {
                id: `thread-${repository}-${number}`,
                path: "src/index.ts",
                startLine: null,
                line: 2,
                side: "RIGHT",
                isResolved: false,
                isOutdated: number % 7 === 0,
                diffHunk: "@@ -1,3 +1,3 @@\n export function answer() {\n-  return 1;\n+  return 2;\n }",
                comments: [
                    {
                        id: `comment-${repository}-${number}-1`,
                        author: faker.internet.username().toLowerCase(),
                        authorAvatarUrl: `https://avatars.githubusercontent.com/u/${faker.number.int({ min: 1, max: 99_999 })}?v=4`,
                        body: "Is returning 2 intentional, or should this stay at 1 until the flag ships?",
                        createdAt: faker.date.recent({ days: 3 }).toISOString(),
                        url: `https://github.com/${repository}/pull/${number}#discussion_r${number}`,
                    },
                ],
            });
        }

        if (number % 3 === 0) {
            github.addConversationComment(DEV_TOKEN, repository, number, {
                id: `issue-comment-${repository}-${number}`,
                databaseId: number * 1000 + 1,
                author: faker.internet.username().toLowerCase(),
                authorAvatarUrl: null,
                body: faker.lorem.paragraph(),
                createdAt: faker.date.recent({ days: 5 }).toISOString(),
                url: `https://github.com/${repository}/pull/${number}#issuecomment-${number}`,
                lastEditedAt: null,
                editor: null,
                editCount: 0,
                edits: [],
                reactionGroups: [],
            });
        }
    }

    // Shared head/base across repos so the Related sidebar has siblings in fake mode.
    for (const [index, repository] of REPOSITORIES.entries()) {
        const number = 200 + index;
        github.addPullRequest(DEV_TOKEN, {
            repository,
            number,
            title: `Cross-repo: ${repository.split("/")[1] ?? repository}`,
            author: DEV_LOGIN,
            headRefName: "feature/cross-repo",
            baseRefName: "main",
            updatedAt: faker.date.recent({ days: 3 }).toISOString(),
            createdAt: faker.date.recent({ days: 8 }).toISOString(),
            checks: "success",
            additions: 12,
            deletions: 2,
            changedFiles: 2,
            body: "Sibling PR for related-branch demos.",
            headSha: faker.git.commitSha(),
            checkRuns: checkRuns("success"),
        });
        github.setPullRequestFiles(DEV_TOKEN, repository, number, seedFiles(number));
    }

    return github;
}

function seedFiles(seed: number): Array<FakeFileInput> {
    const files: Array<FakeFileInput> = [
        {
            path: "src/index.ts",
            status: "modified",
            additions: 3,
            deletions: 1,
            before: "export function main() {\n  return 1\n}\n",
            after: "export function main() {\n  return 2\n}\n\nexport const ready = true\n",
        },
        {
            path: `src/feature-${seed}.ts`,
            status: "added",
            additions: 8,
            deletions: 0,
            after: Array.from({ length: 40 }, (_, index) => `export const line${index} = ${index}`).join("\n") + "\n",
        },
        {
            path: "README.md",
            status: "modified",
            additions: 2,
            deletions: 0,
            before: "# App\n",
            after: `# App\n\n## Change ${seed}\n\n${faker.lorem.paragraph()}\n`,
        },
        {
            path: "package-lock.json",
            status: "modified",
            additions: 20,
            deletions: 20,
            before: '{ "lockfileVersion": 2 }\n',
            after: '{ "lockfileVersion": 3 }\n',
        },
        {
            path: "assets/icon.png",
            status: "added",
            additions: 0,
            deletions: 0,
            afterBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]),
        },
    ];

    if (seed % 11 === 0) {
        files.push({
            path: "data/big.csv",
            status: "added",
            additions: 1,
            deletions: 0,
            afterBytes: new Uint8Array(HUGE_FILE_BYTES + 64).fill(97),
        });
    }

    return files;
}
