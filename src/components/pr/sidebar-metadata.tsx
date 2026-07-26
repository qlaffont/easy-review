import { useSelector } from "@tanstack/react-store";
import { Check, Pencil, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { Label, PullRequestDetail, RepositoryLabel, RepositoryUser, ReviewerStatus } from "#/lib/session/types.ts";

import { Badge } from "#/components/ui/badge.tsx";
import { HelpTooltip } from "#/components/ui/help-tooltip.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { useSession } from "#/lib/session/provider.tsx";

const MAX_ASSIGNEES = 10;
const MAX_REVIEWERS = 15;

const REVIEW_STATE_LABELS = {
    approved: "approved",
    "changes-requested": "requested changes",
    commented: "commented",
    dismissed: "dismissed",
    pending: "pending",
} as const;

/** GitHub-style Reviewers / Assignees / Labels sidebar with gear pickers. */
export function PullRequestSidebarMetadata({
    detail,
    reviewers,
}: {
    detail: PullRequestDetail;
    reviewers: Array<ReviewerStatus>;
}) {
    const session = useSession();
    const meta = useSelector(session.state, () => session.getRepositoryMetadata(detail.repository));
    const canEdit = detail.state === "open";

    useEffect(() => {
        void session.loadRepositoryMetadata(detail.repository);
    }, [session, detail.repository]);

    const usersByLogin = useMemo(() => new Map(meta.users.map((user) => [user.login, user])), [meta.users]);

    return (
        <div className="flex flex-col divide-y text-sm">
            <ReviewersSection
                detail={detail}
                reviewers={reviewers}
                users={meta.users}
                usersByLogin={usersByLogin}
                loading={meta.status === "loading" && meta.users.length === 0}
                canEdit={canEdit}
            />
            <AssigneesSection
                detail={detail}
                users={meta.users}
                usersByLogin={usersByLogin}
                loading={meta.status === "loading" && meta.users.length === 0}
                canEdit={canEdit}
            />
            <LabelsSection
                detail={detail}
                labels={meta.labels}
                loading={meta.status === "loading" && meta.labels.length === 0}
                canEdit={canEdit}
            />
            {meta.error ? <p className="px-0.5 py-2 text-xs text-destructive">{meta.error.message}</p> : null}
        </div>
    );
}

function ReviewersSection({
    detail,
    reviewers,
    users,
    usersByLogin,
    loading,
    canEdit,
}: {
    detail: PullRequestDetail;
    reviewers: Array<ReviewerStatus>;
    users: Array<RepositoryUser>;
    usersByLogin: Map<string, RepositoryUser>;
    loading: boolean;
    canEdit: boolean;
}) {
    const session = useSession();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const requested = new Set(detail.reviewRequests);
    const reviewedLogins = new Set(reviewers.map((reviewer) => reviewer.login));

    async function setRequests(next: Array<string>) {
        setBusy(true);
        setError(null);
        try {
            await session.setReviewRequests(detail.repository, detail.number, next);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not update reviewers.");
        } finally {
            setBusy(false);
        }
    }

    async function toggle(login: string) {
        if (requested.has(login)) {
            await setRequests(detail.reviewRequests.filter((entry) => entry !== login));
            return;
        }

        if (detail.reviewRequests.length >= MAX_REVIEWERS) {
            setError(`You can request up to ${MAX_REVIEWERS} reviewers.`);
            return;
        }

        await setRequests([...detail.reviewRequests, login]);
    }

    return (
        <MetadataSection
            title="Reviewers"
            canEdit={canEdit}
            pickerTitle={`Request up to ${MAX_REVIEWERS} reviewers`}
            searchPlaceholder="Type or choose a user"
            busy={busy}
            error={error}
            loading={loading}
            selectedKeys={detail.reviewRequests}
            items={users.filter((user) => user.login !== detail.author)}
            renderItem={(user, selected) => <UserRow user={user} selected={selected} />}
            getKey={(user) => user.login}
            filterItem={(user, query) => matchesUser(user, query)}
            onToggle={(user) => void toggle(user.login)}
            groupSelected="Requested"
        >
            {reviewers.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                    {reviewers.map((reviewer) => (
                        <li key={reviewer.login} className="flex items-center justify-between gap-2">
                            <UserChip
                                user={
                                    usersByLogin.get(reviewer.login) ?? {
                                        login: reviewer.login,
                                        name: null,
                                        avatarUrl: null,
                                    }
                                }
                            />
                            <span className="shrink-0 text-xs text-muted-foreground">
                                {REVIEW_STATE_LABELS[reviewer.state]}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}

            {detail.reviewRequests.filter((login) => !reviewedLogins.has(login)).length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                    {detail.reviewRequests
                        .filter((login) => !reviewedLogins.has(login))
                        .map((login) => (
                            <li key={login} className="flex items-center justify-between gap-2">
                                <UserChip user={usersByLogin.get(login) ?? { login, name: null, avatarUrl: null }} />
                                <span className="shrink-0 text-xs text-muted-foreground">Awaiting</span>
                            </li>
                        ))}
                </ul>
            ) : null}

            {reviewers.length === 0 && detail.reviewRequests.length === 0 ? (
                <p className="text-muted-foreground">{loading ? "…" : "No reviews"}</p>
            ) : null}
        </MetadataSection>
    );
}

function AssigneesSection({
    detail,
    users,
    usersByLogin,
    loading,
    canEdit,
}: {
    detail: PullRequestDetail;
    users: Array<RepositoryUser>;
    usersByLogin: Map<string, RepositoryUser>;
    loading: boolean;
    canEdit: boolean;
}) {
    const session = useSession();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const assigned = new Set(detail.assignees);

    async function setAssignees(next: Array<string>) {
        setBusy(true);
        setError(null);
        try {
            await session.setPullRequestAssignees(detail.repository, detail.number, next);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not update assignees.");
        } finally {
            setBusy(false);
        }
    }

    async function toggle(login: string) {
        if (assigned.has(login)) {
            await setAssignees(detail.assignees.filter((entry) => entry !== login));
            return;
        }

        if (detail.assignees.length >= MAX_ASSIGNEES) {
            setError(`You can assign up to ${MAX_ASSIGNEES} people.`);
            return;
        }

        await setAssignees([...detail.assignees, login]);
    }

    return (
        <MetadataSection
            title="Assignees"
            canEdit={canEdit}
            pickerTitle={`Assign up to ${MAX_ASSIGNEES} people to this pull request`}
            searchPlaceholder="Type or choose a user"
            busy={busy}
            error={error}
            loading={loading}
            selectedKeys={detail.assignees}
            items={users}
            renderItem={(user, selected) => <UserRow user={user} selected={selected} />}
            getKey={(user) => user.login}
            filterItem={(user, query) => matchesUser(user, query)}
            onToggle={(user) => void toggle(user.login)}
            onClear={detail.assignees.length > 0 ? () => void setAssignees([]) : undefined}
            clearLabel="Clear assignees"
            groupSelected="Assigned"
        >
            {detail.assignees.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                    {detail.assignees.map((login) => (
                        <li key={login}>
                            <UserChip user={usersByLogin.get(login) ?? { login, name: null, avatarUrl: null }} />
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-muted-foreground">{loading ? "…" : "No one—assign someone"}</p>
            )}
        </MetadataSection>
    );
}

function LabelsSection({
    detail,
    labels,
    loading,
    canEdit,
}: {
    detail: PullRequestDetail;
    labels: Array<RepositoryLabel>;
    loading: boolean;
    canEdit: boolean;
}) {
    const session = useSession();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const selected = new Set(detail.labels.map((label) => label.name));

    // Merge applied labels that may no longer appear in the repository catalog.
    const catalog = useMemo(() => {
        const byName = new Map(labels.map((label) => [label.name, label]));
        for (const label of detail.labels) {
            if (!byName.has(label.name)) {
                byName.set(label.name, { ...label, description: null });
            }
        }
        return [...byName.values()];
    }, [labels, detail.labels]);

    async function setLabels(next: Array<Label>) {
        setBusy(true);
        setError(null);
        try {
            await session.setPullRequestLabels(
                detail.repository,
                detail.number,
                next.map((label) => label.name),
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not update labels.");
        } finally {
            setBusy(false);
        }
    }

    async function toggle(label: RepositoryLabel) {
        if (selected.has(label.name)) {
            await setLabels(detail.labels.filter((entry) => entry.name !== label.name));
            return;
        }

        await setLabels([...detail.labels, { name: label.name, color: label.color }]);
    }

    return (
        <MetadataSection
            title="Labels"
            canEdit={canEdit}
            pickerTitle="Apply labels to this pull request"
            searchPlaceholder="Filter labels"
            busy={busy}
            error={error}
            loading={loading}
            selectedKeys={[...selected]}
            items={catalog}
            renderItem={(label, isSelected) => <LabelRow label={label} selected={isSelected} />}
            getKey={(label) => label.name}
            filterItem={(label, query) =>
                label.name.toLowerCase().includes(query) || (label.description?.toLowerCase().includes(query) ?? false)
            }
            onToggle={(label) => void toggle(label)}
            footer={
                <a
                    href={`https://github.com/${detail.repository}/labels`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Edit labels
                </a>
            }
        >
            {detail.labels.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                    {detail.labels.map((label) => (
                        <li key={label.name}>
                            <Badge
                                variant="outline"
                                className="font-normal"
                                style={{ borderColor: `#${label.color}`, color: `#${label.color}` }}
                            >
                                {label.name}
                            </Badge>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-muted-foreground">{loading ? "…" : "None yet"}</p>
            )}
        </MetadataSection>
    );
}

function MetadataSection<T>({
    title,
    canEdit,
    pickerTitle,
    searchPlaceholder,
    busy,
    error,
    loading,
    selectedKeys,
    items,
    renderItem,
    getKey,
    filterItem,
    onToggle,
    onClear,
    clearLabel,
    groupSelected,
    footer,
    children,
}: {
    title: string;
    canEdit: boolean;
    pickerTitle: string;
    searchPlaceholder: string;
    busy: boolean;
    error: string | null;
    loading: boolean;
    selectedKeys: Array<string>;
    items: Array<T>;
    renderItem: (item: T, selected: boolean) => React.ReactNode;
    getKey: (item: T) => string;
    filterItem: (item: T, query: string) => boolean;
    onToggle: (item: T) => void;
    onClear?: () => void;
    clearLabel?: string;
    groupSelected?: string;
    footer?: ReactNode;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const selected = new Set(selectedKeys);
    const normalized = query.trim().toLowerCase();

    const filtered = items.filter((item) => (normalized ? filterItem(item, normalized) : true));
    const selectedItems = filtered.filter((item) => selected.has(getKey(item)));
    const otherItems = filtered.filter((item) => !selected.has(getKey(item)));

    return (
        <section className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
                {canEdit ? (
                    <Popover
                        open={open}
                        onOpenChange={(next) => {
                            setOpen(next);
                            if (!next) {
                                setQuery("");
                            }
                        }}
                    >
                        <HelpTooltip label={`Edit ${title.toLowerCase()}`}>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    disabled={busy}
                                    aria-label={`Edit ${title.toLowerCase()}`}
                                    className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Settings2 className="size-3.5" aria-hidden="true" />
                                </button>
                            </PopoverTrigger>
                        </HelpTooltip>
                        <PopoverContent
                            align="end"
                            className="w-72 gap-0 overflow-hidden rounded-lg border p-0 shadow-md"
                        >
                            <div className="border-b px-3 py-2">
                                <p className="text-xs font-medium text-muted-foreground">{pickerTitle}</p>
                            </div>
                            <div className="border-b px-2 py-2">
                                <Input
                                    autoFocus
                                    value={query}
                                    placeholder={searchPlaceholder}
                                    className="h-8 rounded-md text-sm shadow-none"
                                    onChange={(event) => setQuery(event.target.value)}
                                />
                            </div>
                            {onClear ? (
                                <button
                                    type="button"
                                    disabled={busy}
                                    className="flex w-full cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={onClear}
                                >
                                    <X className="size-3.5" aria-hidden="true" />
                                    {clearLabel ?? "Clear"}
                                </button>
                            ) : null}
                            <div className="max-h-64 overflow-y-auto py-1">
                                {loading && items.length === 0 ? (
                                    <p className="px-3 py-3 text-xs text-muted-foreground">Loading…</p>
                                ) : filtered.length === 0 ? (
                                    <p className="px-3 py-3 text-xs text-muted-foreground">Nothing matched.</p>
                                ) : (
                                    <>
                                        {selectedItems.length > 0 ? (
                                            <PickerGroup label={groupSelected}>
                                                {selectedItems.map((item) => (
                                                    <PickerButton
                                                        key={getKey(item)}
                                                        disabled={busy}
                                                        onClick={() => onToggle(item)}
                                                    >
                                                        {renderItem(item, true)}
                                                    </PickerButton>
                                                ))}
                                            </PickerGroup>
                                        ) : null}
                                        {otherItems.length > 0 ? (
                                            <PickerGroup>
                                                {otherItems.map((item) => (
                                                    <PickerButton
                                                        key={getKey(item)}
                                                        disabled={busy}
                                                        onClick={() => onToggle(item)}
                                                    >
                                                        {renderItem(item, false)}
                                                    </PickerButton>
                                                ))}
                                            </PickerGroup>
                                        ) : null}
                                    </>
                                )}
                            </div>
                            {footer}
                        </PopoverContent>
                    </Popover>
                ) : null}
            </div>
            {children}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </section>
    );
}

function PickerGroup({ label, children }: { label?: string; children: ReactNode }) {
    return (
        <div className="flex flex-col">
            {label ? (
                <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">{label}</p>
            ) : null}
            <div className="flex flex-col">{children}</div>
        </div>
    );
}

function PickerButton({
    children,
    disabled,
    onClick,
}: {
    children: ReactNode;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function UserChip({ user }: { user: RepositoryUser }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <UserAvatar user={user} />
            <span className="truncate text-sm">{user.login}</span>
        </span>
    );
}

function UserRow({ user, selected }: { user: RepositoryUser; selected: boolean }) {
    return (
        <>
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                {selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
            </span>
            <UserAvatar user={user} />
            <span className="min-w-0 flex-1 truncate">
                <span className="text-sm">{user.login}</span>
                {user.name ? <span className="ml-1.5 text-xs text-muted-foreground">{user.name}</span> : null}
            </span>
        </>
    );
}

function LabelRow({ label, selected }: { label: RepositoryLabel; selected: boolean }) {
    return (
        <>
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                {selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
            </span>
            <span
                className="size-3 shrink-0 rounded-full border border-black/10 dark:border-white/10"
                style={{ backgroundColor: `#${label.color}` }}
                aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{label.name}</span>
                {label.description ? (
                    <span className="block truncate text-xs text-muted-foreground">{label.description}</span>
                ) : null}
            </span>
        </>
    );
}

function UserAvatar({ user }: { user: RepositoryUser }) {
    if (user.avatarUrl) {
        return <img src={user.avatarUrl} alt="" className="size-5 shrink-0 rounded-full" />;
    }

    return (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
            {user.login.slice(0, 1).toUpperCase()}
        </span>
    );
}

function matchesUser(user: RepositoryUser, query: string): boolean {
    return user.login.toLowerCase().includes(query) || (user.name?.toLowerCase().includes(query) ?? false);
}
