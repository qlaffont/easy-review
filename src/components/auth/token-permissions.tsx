const PERMISSIONS = [
    { name: "Repository access", level: "Only select repositories", why: "Pick the repos you want in your Inbox." },
    { name: "Metadata", level: "Read-only", why: "Required by GitHub for every fine-grained token." },
    {
        name: "Pull requests",
        level: "Read and write",
        why: "Read PRs, submit reviews, edit reviewers, labels and assignees.",
    },
    { name: "Contents", level: "Read and write", why: "Read file diffs, and merge a pull request." },
    { name: "Commit statuses", level: "Read-only", why: "Show CI status on Inbox rows and the PR overview." },
    { name: "Checks", level: "Read-only", why: "Show check runs on Inbox rows and the PR overview." },
];

export function TokenPermissions() {
    return (
        <dl className="divide-y divide-border overflow-hidden rounded-lg border text-sm">
            {PERMISSIONS.map((permission) => (
                <div key={permission.name} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
                    <dt className="font-medium">{permission.name}</dt>
                    <dd className="text-muted-foreground">
                        <span className="text-foreground">{permission.level}</span>
                        <span aria-hidden="true"> — </span>
                        {permission.why}
                    </dd>
                </div>
            ))}
        </dl>
    );
}
