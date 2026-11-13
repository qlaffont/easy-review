/**
 * An open pull request whose head branch is another pull request's base: the one "below" it.
 * GitHub can stack the two, the lower one first.
 */
export type PullRequestBelow = {
    number: number;
    title: string;
    url: string;
    isDraft: boolean;
    author: string | null;
    headRefName: string;
    baseRefName: string;
    /** Head branch lives in a fork: GitHub cannot stack it. */
    isCrossRepository: boolean;
    /** Its GitHub stack, when it already has one. `position` 1 is the bottom, `size` the top. */
    stack: { number: number; size: number; position: number } | null;
};

/** What GitHub says about the pull request below a given one, in one lookup. */
export type PullRequestsBelowLookup = {
    /** The focal pull request's head branch lives in a fork. */
    currentIsCrossRepository: boolean;
    /** Open pull requests whose head branch is the focal pull request's base. */
    candidates: Array<PullRequestBelow>;
};

export type StackSuggestion =
    /** Neither is stacked: start a stack, the pull request below at the bottom. */
    | { kind: "create"; below: PullRequestBelow; pullRequests: [number, number] }
    /** The pull request below tops a stack: put this one on top of it. */
    | { kind: "add"; below: PullRequestBelow; stackNumber: number; pullRequests: [number] };

/**
 * Whether to offer stacking an open, unstacked pull request onto the open one below it. Only when
 * exactly one pull request sits below (anything else is ambiguous), both branches live in this
 * repository, and the one below is unstacked or the top of its stack (GitHub only appends on top).
 */
export function stackSuggestionFor(
    current: { number: number; state: "open" | "closed" | "merged"; baseRefName: string; inStack: boolean },
    lookup: PullRequestsBelowLookup,
): StackSuggestion | null {
    if (current.state !== "open" || current.inStack || lookup.currentIsCrossRepository) {
        return null;
    }

    const candidates = lookup.candidates.filter(
        (candidate) => candidate.number !== current.number && candidate.headRefName === current.baseRefName,
    );
    if (candidates.length !== 1) {
        return null;
    }

    const below = candidates[0]!;
    if (below.isCrossRepository) {
        return null;
    }

    if (!below.stack) {
        return { kind: "create", below, pullRequests: [below.number, current.number] };
    }
    if (below.stack.position === below.stack.size) {
        return { kind: "add", below, stackNumber: below.stack.number, pullRequests: [current.number] };
    }
    return null;
}

const DISMISSED_STORAGE_KEY = "easy-review:stack-suggestion-dismissed:v1";

function dismissalKey(repository: string, number: number, belowNumber: number): string {
    return `${repository}#${number}<${belowNumber}`;
}

function readDismissed(): Array<string> {
    try {
        const raw = globalThis.localStorage?.getItem(DISMISSED_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
}

/** The user said no to stacking this pull request onto that one: don't ask again. */
export function isStackSuggestionDismissed(repository: string, number: number, belowNumber: number): boolean {
    return readDismissed().includes(dismissalKey(repository, number, belowNumber));
}

/** Keeps the most recent 200 dismissals. */
export function dismissStackSuggestion(repository: string, number: number, belowNumber: number): void {
    const key = dismissalKey(repository, number, belowNumber);
    const next = [...readDismissed().filter((entry) => entry !== key), key].slice(-200);
    try {
        globalThis.localStorage?.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Blocked storage: the suggestion comes back next visit.
    }
}
