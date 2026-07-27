import { ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import type { CommitSignature } from "#/lib/session/types.ts";

import { Button } from "#/components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { formatAbsoluteTime } from "#/lib/format.ts";

/** Green “Verified” chip + signature details for a signed commit. */
export function CommitVerifiedBadge({ signature, verifiedAt }: { signature: CommitSignature; verifiedAt: string }) {
    const [open, setOpen] = useState(false);
    const signerLogin = signature.signerLogin ?? "unknown";
    const keyLabel = signature.keyId
        ? signature.keyId.includes(":") || signature.keyId.length > 16
            ? "SSH key fingerprint"
            : "GPG key ID"
        : null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="inline-flex cursor-pointer items-center rounded-full border border-emerald-600/30 bg-emerald-500/5 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
                    aria-label="Verified commit signature"
                >
                    Verified
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0">
                <div className="flex items-start gap-2 border-b px-3 py-2.5">
                    <ShieldCheck
                        className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                    />
                    <p className="min-w-0 flex-1 text-sm">
                        This commit was signed with the committer&apos;s{" "}
                        <span className="font-semibold text-emerald-700 dark:text-emerald-300">verified signature</span>
                        .
                    </p>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 shrink-0 text-muted-foreground"
                        aria-label="Close"
                        onClick={() => setOpen(false)}
                    >
                        <X className="size-3.5" aria-hidden="true" />
                    </Button>
                </div>
                <div className="flex items-center gap-2 px-3 py-3">
                    {signature.signerAvatarUrl ? (
                        <img src={signature.signerAvatarUrl} alt="" className="size-8 shrink-0 rounded-full" />
                    ) : (
                        <span
                            aria-hidden="true"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase"
                        >
                            {signerLogin.slice(0, 1)}
                        </span>
                    )}
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{signerLogin}</p>
                        {signature.signerName ? (
                            <p className="truncate text-xs text-muted-foreground">{signature.signerName}</p>
                        ) : null}
                    </div>
                </div>
                <div className="space-y-1 border-t px-3 py-2.5 text-xs text-muted-foreground">
                    {keyLabel && signature.keyId ? (
                        <p>
                            {keyLabel}: <span className="font-mono text-foreground">{signature.keyId}</span>
                        </p>
                    ) : null}
                    <p>Verified on {formatAbsoluteTime(verifiedAt)}</p>
                    <a
                        href="https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-sky-700 hover:underline dark:text-sky-400"
                    >
                        Learn about vigilant mode
                    </a>
                </div>
            </PopoverContent>
        </Popover>
    );
}
