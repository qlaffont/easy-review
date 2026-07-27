import { beforeEach, describe, expect, it } from "vitest";

import type { FakeGithub } from "#/lib/session/testing/fake-github.ts";
import type { MemoryStore } from "#/lib/session/testing/memory-store.ts";

import { createEasyReviewSession } from "#/lib/session/session.ts";
import { createFakeGithub } from "#/lib/session/testing/fake-github.ts";
import { createMemoryStore } from "#/lib/session/testing/memory-store.ts";

const TOKEN = "github_pat_valid";

let github: FakeGithub;
let store: MemoryStore;

async function connectedWithPr() {
    const session = createEasyReviewSession({ github, store });
    await session.connect(TOKEN);
    await session.setSelectedRepositories(["acme/api"]);
    await session.loadInbox();
    await session.loadPullRequest("acme/api", 1);
    return session;
}

beforeEach(() => {
    github = createFakeGithub();
    store = createMemoryStore();
    github.addAccount(TOKEN, { login: "quentin" });
    github.addRepository(TOKEN, "acme/api");
    github.addPullRequest(TOKEN, {
        repository: "acme/api",
        number: 1,
        title: "Ship lifecycle",
        author: "quentin",
        isDraft: true,
        reviewRequests: ["hubot"],
        labels: [{ name: "bug", color: "d73a4a" }],
        assignees: ["quentin"],
        mergeable: "mergeable",
    });
});

describe("pull request lifecycle", () => {
    it("marks a draft ready and updates the overview and inbox row", async () => {
        const session = await connectedWithPr();

        await session.setPullRequestDraft("acme/api", 1, false);

        expect(session.getPullRequestPage("acme/api", 1).detail?.isDraft).toBe(false);
        expect(session.state.state.inbox.pullRequests[0]?.isDraft).toBe(false);
        expect(github.calls).toContain("setPullRequestDraft");
    });

    it("replaces labels and assignees", async () => {
        const session = await connectedWithPr();

        await session.setPullRequestLabels("acme/api", 1, ["enhancement", "infra"]);
        await session.setPullRequestAssignees("acme/api", 1, ["hubot"]);

        const detail = session.getPullRequestPage("acme/api", 1).detail;
        expect(detail?.labels.map((label) => label.name)).toEqual(["enhancement", "infra"]);
        expect(detail?.assignees).toEqual(["hubot"]);
    });

    it("adds and removes review requests, then re-requests", async () => {
        const session = await connectedWithPr();

        await session.setReviewRequests("acme/api", 1, ["hubot", "mona"]);
        expect(session.getPullRequestPage("acme/api", 1).detail?.reviewRequests).toEqual(["hubot", "mona"]);

        await session.setReviewRequests("acme/api", 1, ["mona"]);
        expect(session.getPullRequestPage("acme/api", 1).detail?.reviewRequests).toEqual(["mona"]);

        await session.reRequestReview("acme/api", 1, ["mona"]);
        expect(github.calls).toContain("reRequestReview");
        expect(session.getPullRequestPage("acme/api", 1).detail?.reviewRequests).toContain("mona");
    });

    it("dismisses a review by id", async () => {
        github.addPullRequest(TOKEN, {
            repository: "acme/api",
            number: 2,
            author: "octocat",
            reviewers: [{ login: "hubot", state: "approved", reviewId: 42 }],
        });
        const session = createEasyReviewSession({ github, store });
        await session.connect(TOKEN);
        await session.setSelectedRepositories(["acme/api"]);
        await session.loadPullRequest("acme/api", 2);

        await session.dismissReview("acme/api", 2, 42);

        expect(github.calls).toContain("dismissReview");
        expect(session.getPullRequestPage("acme/api", 2).detail?.reviewers).toEqual([
            { login: "hubot", state: "dismissed", reviewId: 42 },
        ]);
    });

    it("merges an open pull request and reflects merged state in the inbox", async () => {
        const session = await connectedWithPr();
        await session.setPullRequestDraft("acme/api", 1, false);

        await session.mergePullRequest("acme/api", 1, "squash");

        expect(session.getPullRequestPage("acme/api", 1).detail?.state).toBe("merged");
        expect(session.state.state.inbox.pullRequests[0]?.state).toBe("merged");
    });

    it("closes an open pull request after the mutation succeeds", async () => {
        const session = await connectedWithPr();

        await session.closePullRequest("acme/api", 1);

        expect(session.getPullRequestPage("acme/api", 1).detail?.state).toBe("closed");
        expect(session.state.state.inbox.pullRequests[0]?.state).toBe("closed");
    });
});
