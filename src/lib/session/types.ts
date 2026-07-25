export type Repository = {
    /** `owner/repo`, the identity Easy Review uses everywhere. */
    nameWithOwner: string;
    owner: string;
    name: string;
    isPrivate: boolean;
    isArchived: boolean;
    /** ISO timestamp of the last push, used to order the picker. */
    pushedAt: string | null;
};
