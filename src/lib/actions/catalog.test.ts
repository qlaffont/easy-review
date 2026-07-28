import { describe, expect, it, vi } from "vitest";

import type { ActionContext, ActionTarget } from "#/lib/actions/catalog.ts";
import type { EasyReviewSession } from "#/lib/session/session.ts";

import { APP_ACTIONS, availableActions, findAction } from "#/lib/actions/catalog.ts";

function target(overrides: Partial<ActionTarget> = {}): ActionTarget {
    return {
        repository: "acme/api",
        number: 1,
        title: "Ship it",
        url: "https://github.com/acme/api/pull/1",
        headRefName: "feature-1",
        isDraft: false,
        state: "open",
        ...overrides,
    };
}

function context(overrides: Partial<ActionContext> = {}): ActionContext {
    return {
        session: {
            refreshInbox: vi.fn(),
            refreshPullRequest: vi.fn(),
            setPullRequestDraft: vi.fn(),
            closePullRequest: vi.fn(),
            mergePullRequest: vi.fn(),
            setReviewEvent: vi.fn(),
            submitReview: vi.fn(),
        } as unknown as EasyReviewSession,
        surface: "pull-request",
        target: target(),
        openRepoPicker: vi.fn(),
        goToInbox: vi.fn(),
        openPullRequest: vi.fn(),
        openReviewChanges: vi.fn(),
        copyText: vi.fn(),
        confirm: () => true,
        ...overrides,
    };
}

describe("action catalog", () => {
    it("exposes stable ids so chords can attach later", () => {
        const ids = APP_ACTIONS.map((action) => action.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every((id) => id.includes("."))).toBe(true);
    });

    it("on inbox with nothing selected, only shows inbox commands", () => {
        const actions = availableActions(context({ surface: "inbox", target: null }));
        expect(actions.map((action) => action.id)).toEqual(["inbox.refresh", "inbox.choose-repos"]);
    });

    it("on inbox with a selection, offers open/copy but not PR lifecycle", () => {
        const ids = availableActions(context({ surface: "inbox", target: target() })).map((action) => action.id);
        expect(ids).toContain("nav.open-selected");
        expect(ids).toContain("copy.pr-url");
        expect(ids).toContain("inbox.refresh");
        expect(ids).not.toContain("nav.inbox");
        expect(ids).not.toContain("pr.close");
        expect(ids).not.toContain("pr.refresh");
    });

    it("on a pull request page, offers inbox nav and PR actions, not inbox triage", () => {
        const ids = availableActions(context({ surface: "pull-request", target: target() })).map((action) => action.id);
        expect(ids).toContain("nav.inbox");
        expect(ids).toContain("pr.refresh");
        expect(ids).toContain("pr.close");
        expect(ids).not.toContain("nav.open-selected");
        expect(ids).not.toContain("inbox.refresh");
        expect(ids).not.toContain("inbox.choose-repos");
    });

    it("offers ready-for-review only while the focused PR is a draft", () => {
        expect(
            availableActions(context({ target: target({ isDraft: true }) })).some(
                (action) => action.id === "pr.ready-for-review",
            ),
        ).toBe(true);
        expect(
            availableActions(context({ target: target({ isDraft: false }) })).some(
                (action) => action.id === "pr.ready-for-review",
            ),
        ).toBe(false);
    });

    it("copies URL, title, and branch through the clipboard port", async () => {
        const copyText = vi.fn();
        const ctx = context({ copyText });

        await findAction("copy.pr-url")!.run(ctx);
        await findAction("copy.github-url")!.run(ctx);
        await findAction("copy.pr-title")!.run(ctx);
        await findAction("copy.branch")!.run(ctx);

        expect(copyText).toHaveBeenCalledWith(expect.stringContaining("/pr/acme/api/1"));
        expect(copyText).toHaveBeenCalledWith("https://github.com/acme/api/pull/1");
        expect(copyText).toHaveBeenCalledWith("Ship it");
        expect(copyText).toHaveBeenCalledWith("feature-1");
    });

    it("opens the selected pull request through navigation, not a one-off handler", () => {
        const openPullRequest = vi.fn();
        findAction("nav.open-selected")!.run(context({ openPullRequest }));
        expect(openPullRequest).toHaveBeenCalledWith("acme/api", 1);
    });

    it("asks for confirmation before closing", async () => {
        const closePullRequest = vi.fn();
        const confirm = vi.fn(() => false);
        await findAction("pr.close")!.run(
            context({
                confirm,
                session: { closePullRequest } as unknown as EasyReviewSession,
            }),
        );
        expect(confirm).toHaveBeenCalled();
        expect(closePullRequest).not.toHaveBeenCalled();
    });
});
