import { Check, Copy, ExternalLink, Film, PencilLine } from "lucide-react";
import {
    Children,
    createContext,
    isValidElement,
    lazy,
    memo,
    Suspense,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ComponentPropsWithoutRef,
    type ReactElement,
    type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { remarkAlert } from "remark-github-blockquote-alert";

import { SuggestionApplyActions, type SuggestionApplyTarget } from "#/components/pr/suggestion-apply.tsx";
import {
    attachmentLabelFromLinkText,
    isAllowedResolvedAttachmentSrc,
    isGithubPrivateMediaUrl,
    isGithubRepoBlobRawUrl,
    isGithubUserAttachmentUrl,
    isGraphiteUserAttachmentUrl,
    mediaKindFromLinkText,
    parseGraphiteUserAttachmentUrl,
    repositoryFromGithubBaseUrl,
    shouldEmbedGithubAttachment,
    shouldEmbedGraphiteAttachment,
    type ResolvedGithubAttachment,
} from "#/lib/github-attachment.ts";
import { prepareMarkdownSource } from "#/lib/markdown-source.ts";
import { remarkBoldMentions } from "#/lib/remark-bold-mentions.ts";
import { remarkGithubEmoji } from "#/lib/remark-github-emoji.ts";
import { useOptionalSession } from "#/lib/session/provider.tsx";
import { notifyCopied, notifyError } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

/** Client-only; keep out of the SSR graph so Nitro does not ship mermaid on the server. */
const MermaidDiagram = lazy(() =>
    import("#/components/pr/mermaid-diagram.tsx").then((module) => ({ default: module.MermaidDiagram })),
);

/**
 * Alert / icon classes from `remark-github-blockquote-alert` only. Unrestricted `className`
 * would let hostile PR bodies use Tailwind utilities (`fixed inset-0 z-50 …`) to spoof UI.
 */
const ALERT_CLASS = /^markdown-alert(?:-[\w-]+)?$/;
const SECTION_CLASS = /^(?:markdown-alert(?:-[\w-]+)?|footnotes)$/;
const OCTICON_CLASS = /^octicon$/;
const GRAPHITE_HIDDEN_CLASS = /^graphite__hidden$/;

/**
 * Allow the same structural HTML GitHub keeps in issue/PR bodies, plus alert markup
 * produced by `remark-github-blockquote-alert` (div/svg/path + allowlisted classes).
 */
const sanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), "svg", "path", "section", "video"],
    attributes: {
        ...defaultSchema.attributes,
        div: [...(defaultSchema.attributes?.div ?? []), ["className", ALERT_CLASS], ["class", ALERT_CLASS], "dir"],
        p: [...(defaultSchema.attributes?.p ?? []), ["className", ALERT_CLASS], ["class", ALERT_CLASS], "dir"],
        section: [
            ...(defaultSchema.attributes?.section ?? []).filter(
                (entry) => !(Array.isArray(entry) && entry[0] === "className"),
            ),
            ["className", SECTION_CLASS],
            ["class", SECTION_CLASS],
            "dir",
        ],
        details: [...(defaultSchema.attributes?.details ?? []), "open"],
        summary: [...(defaultSchema.attributes?.summary ?? [])],
        svg: [
            ["className", OCTICON_CLASS],
            ["class", OCTICON_CLASS],
            "viewBox",
            "width",
            "height",
            "ariaHidden",
            "aria-hidden",
            "fill",
            "role",
            "xmlns",
        ],
        path: ["d", "fill", "fillRule", "fill-rule", "clipRule", "clip-rule"],
        span: [
            ...(defaultSchema.attributes?.span ?? []),
            ["className", GRAPHITE_HIDDEN_CLASS],
            ["class", GRAPHITE_HIDDEN_CLASS],
        ],
        input: [...(defaultSchema.attributes?.input ?? []), "disabled", "checked", "type"],
        video: ["src", "controls", "playsInline", "playsinline", "preload", "width", "height"],
    },
};

/** GitHub- and Graphite-hosted images only — blocks arbitrary tracking pixels in PR/comment markdown. */
function isAllowedMarkdownImageSrc(src: string | undefined): boolean {
    if (!src) {
        return false;
    }

    try {
        const url = new URL(src, "https://github.com");
        if (url.protocol !== "https:" && url.protocol !== "http:") {
            return false;
        }
        const host = url.hostname.toLowerCase();
        return (
            host === "github.com" ||
            host === "www.github.com" ||
            host.endsWith(".github.com") ||
            host.endsWith(".githubusercontent.com") ||
            host.endsWith(".amazonaws.com") ||
            isGraphiteUserAttachmentUrl(src)
        );
    } catch {
        return false;
    }
}

const remarkPlugins = [remarkGfm, remarkAlert, remarkGithubEmoji, remarkBoldMentions];
const rehypePlugins: Array<typeof rehypeRaw | [typeof rehypeSanitize, typeof sanitizeSchema]> = [
    rehypeRaw,
    [rehypeSanitize, sanitizeSchema],
];

/** `https://github.com/{login}` with no further path — GitHub user profile / mention target. */
function isGithubUserMentionHref(href: string | undefined): boolean {
    if (!href) {
        return false;
    }

    try {
        const url = new URL(href, "https://github.com");
        if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
            return false;
        }
        const parts = url.pathname.split("/").filter(Boolean);
        return parts.length === 1 && /^[a-zA-Z\d](?:[a-zA-Z\d-]{0,37}[a-zA-Z\d])?$/.test(parts[0]!);
    } catch {
        return false;
    }
}

type SuggestionContextValue = {
    original: string | null;
    /** First line of the replaced range (GitHub suggestion start). */
    startLine: number | null;
    /** Last line of the replaced range (GitHub suggestion end / comment line). */
    endLine: number | null;
    apply: SuggestionApplyTarget | null;
};

const SuggestionContext = createContext<SuggestionContextValue>({
    original: null,
    startLine: null,
    endLine: null,
    apply: null,
});

type TaskListContextValue = {
    onToggle: ((index: number, checked: boolean) => void) | null;
    nextIndex: () => number;
};

const TaskListContext = createContext<TaskListContextValue>({
    onToggle: null,
    nextIndex: () => 0,
});

function MarkdownCheckbox({ checked, defaultChecked }: ComponentPropsWithoutRef<"input">) {
    const { onToggle, nextIndex } = useContext(TaskListContext);
    const indexRef = useRef<number | null>(null);
    if (indexRef.current === null) {
        indexRef.current = nextIndex();
    }
    const index = indexRef.current;
    const interactive = onToggle !== null;
    const isChecked = Boolean(checked ?? defaultChecked);

    return (
        <input
            type="checkbox"
            className={cn("relative z-10 mr-1.5 align-middle", interactive && "cursor-pointer")}
            checked={isChecked}
            disabled={!interactive}
            onClick={(event) => {
                event.stopPropagation();
            }}
            onChange={
                interactive
                    ? (event) => {
                          onToggle(index, event.target.checked);
                      }
                    : undefined
            }
        />
    );
}

function codeChildFromPre(children: ReactNode): ReactElement<{ className?: string; children?: ReactNode }> | null {
    const child = Children.toArray(children).find((node) => isValidElement(node)) as
        | ReactElement<{ className?: string; children?: ReactNode }>
        | undefined;
    return child ?? null;
}

function fencedCodeFromPre(children: ReactNode, language: string): string | null {
    const child = codeChildFromPre(children);
    if (!child || !new RegExp(`\\blanguage-${language}\\b`).test(child.props.className ?? "")) {
        return null;
    }
    return String(child.props.children ?? "").replace(/\n$/, "");
}

function DiffRows({ lines, kind, startLine }: { lines: Array<string>; kind: "del" | "add"; startLine: number | null }) {
    return (
        <>
            {lines.map((line, index) => {
                const number = startLine == null ? null : startLine + index;
                return (
                    <div
                        key={`${kind}-${index}-${line}`}
                        className={cn(
                            "flex font-mono text-[12px] leading-[20px]",
                            kind === "del"
                                ? "bg-[#ffebe9] text-[#24292f] dark:bg-red-950/50 dark:text-red-50"
                                : "bg-[#dafbe1] text-[#24292f] dark:bg-emerald-950/40 dark:text-emerald-50",
                        )}
                    >
                        <span
                            aria-hidden="true"
                            className={cn(
                                "w-12 shrink-0 select-none border-r px-2 text-right tabular-nums",
                                kind === "del"
                                    ? "border-red-500/20 text-red-800/70 dark:text-red-300/70"
                                    : "border-emerald-600/20 text-emerald-900/70 dark:text-emerald-300/70",
                            )}
                        >
                            {number ?? ""}
                        </span>
                        <span className="min-w-0 flex-1 whitespace-pre px-2">{line || " "}</span>
                    </div>
                );
            })}
        </>
    );
}

function SuggestionBlock({ code }: { code: string }) {
    const { original, startLine, endLine, apply } = useContext(SuggestionContext);
    const added = code.length === 0 ? [""] : code.split("\n");
    const removed =
        original == null || original === code
            ? []
            : original.length === 0
              ? [""]
              : original.replace(/\n$/, "").split("\n");
    const canCommit =
        apply != null &&
        apply.canApply &&
        startLine != null &&
        endLine != null &&
        Number.isInteger(startLine) &&
        Number.isInteger(endLine) &&
        endLine >= startLine;

    return (
        <div className="my-3 overflow-hidden rounded-md border border-border bg-background not-prose">
            <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold text-foreground">
                <PencilLine className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span>Suggested change</span>
            </div>
            <div className="overflow-x-auto">
                <pre className="m-0 min-w-full p-0">
                    {removed.length > 0 ? <DiffRows lines={removed} kind="del" startLine={startLine} /> : null}
                    <DiffRows lines={added} kind="add" startLine={startLine} />
                </pre>
            </div>
            {canCommit && apply && startLine != null && endLine != null ? (
                <SuggestionApplyActions
                    apply={apply}
                    change={{
                        path: apply.path,
                        startLine,
                        endLine,
                        replacement: code,
                        original,
                    }}
                />
            ) : null}
        </div>
    );
}

function CopyCodeButton({ code }: { code: string }) {
    const [copied, setCopied] = useState(false);

    return (
        <button
            type="button"
            className="absolute top-2 right-2 inline-flex size-7 cursor-pointer items-center justify-center rounded-md border border-border/80 bg-background/90 text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Copy"
            onClick={() => {
                void navigator.clipboard.writeText(code).then(
                    () => {
                        notifyCopied("code");
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                    },
                    () => notifyError("Could not copy"),
                );
            }}
        >
            {copied ? (
                <Check className="size-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
                <Copy className="size-3.5" aria-hidden="true" />
            )}
        </button>
    );
}

/** Soft GitHub-like fence: one gray panel + copy, no nested border. */
function CodeFenceBlock({ code, wrap = false, children }: { code: string; wrap?: boolean; children?: ReactNode }) {
    return (
        <div className="group/code relative my-2 overflow-hidden rounded-md bg-muted/70 not-prose dark:bg-muted/40">
            <CopyCodeButton code={code} />
            {children ? (
                <div className="m-0 overflow-x-auto p-3 font-mono text-[12px] leading-5 text-foreground">
                    {children}
                </div>
            ) : (
                <pre
                    className={cn(
                        "m-0 overflow-x-auto p-3 font-mono text-[12px] leading-5 text-foreground",
                        wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                    )}
                >
                    {code}
                </pre>
            )}
        </div>
    );
}

/** GitHub-style ```diff fences: full-row red/green backgrounds for − / + lines. */
function DiffFenceBlock({ code }: { code: string }) {
    const lines = code.length === 0 ? [""] : code.split("\n");

    return (
        <CodeFenceBlock code={code}>
            {lines.map((line, index) => {
                const isFileHeader = line.startsWith("---") || line.startsWith("+++");
                const isHunkHeader = line.startsWith("@@");
                const kind =
                    !isFileHeader && line.startsWith("+")
                        ? "add"
                        : !isFileHeader && line.startsWith("-")
                          ? "del"
                          : "context";

                return (
                    <div
                        key={`diff-${index}-${line}`}
                        className={cn(
                            "flex whitespace-pre",
                            kind === "add" && "bg-emerald-500/15 text-emerald-950 dark:text-emerald-50",
                            kind === "del" && "bg-red-500/15 text-red-950 dark:text-red-50",
                            (isHunkHeader || isFileHeader) && "bg-sky-500/10 text-sky-900 dark:text-sky-100",
                            kind === "context" && !isHunkHeader && !isFileHeader && "text-foreground",
                        )}
                    >
                        <span
                            aria-hidden="true"
                            className={cn(
                                "w-5 shrink-0 select-none text-center",
                                kind === "add" && "text-emerald-700 dark:text-emerald-300",
                                kind === "del" && "text-red-700 dark:text-red-300",
                                kind === "context" && "text-muted-foreground",
                            )}
                        >
                            {kind === "add" ? "+" : kind === "del" ? "-" : " "}
                        </span>
                        <span className="min-w-0 flex-1 px-2">
                            {kind === "add" || kind === "del" ? line.slice(1) : line || " "}
                        </span>
                    </div>
                );
            })}
        </CodeFenceBlock>
    );
}

function linkChildrenText(children: ReactNode): string {
    return Children.toArray(children)
        .map((child) => {
            if (typeof child === "string" || typeof child === "number") {
                return String(child);
            }
            if (isValidElement<{ children?: ReactNode; alt?: string }>(child)) {
                if (typeof child.props.alt === "string" && child.props.alt.trim()) {
                    return child.props.alt.trim();
                }
                return linkChildrenText(child.props.children);
            }
            return "";
        })
        .join("");
}

function linkContainsEmbeddedMedia(children: ReactNode): boolean {
    return Children.toArray(children).some((child) => {
        if (!isValidElement<{ src?: string; children?: ReactNode }>(child)) {
            return false;
        }
        if (typeof child.props.src === "string" && child.props.src.length > 0) {
            return true;
        }
        if (child.props.children) {
            return linkContainsEmbeddedMedia(child.props.children);
        }
        return false;
    });
}

/** Prefer a signed CDN URL already present in GitHub’s HTML thumbnail wrapper. */
function firstResolvedMediaFromChildren(children: ReactNode): ResolvedGithubAttachment | null {
    for (const child of Children.toArray(children)) {
        if (!isValidElement<{ src?: string; children?: ReactNode; alt?: string }>(child)) {
            continue;
        }
        const childSrc = child.props.src;
        if (typeof childSrc === "string" && isAllowedResolvedAttachmentSrc(childSrc)) {
            const kind =
                mediaKindFromLinkText(child.props.alt ?? "") ??
                (/\.(mp4|webm|mov)(?:\?|$)/i.test(childSrc) ? "video" : "image");
            return {
                kind,
                src: childSrc,
                ...(child.props.alt?.trim() ? { name: child.props.alt.trim() } : {}),
            };
        }
        if (child.props.children) {
            const nested = firstResolvedMediaFromChildren(child.props.children);
            if (nested) {
                return nested;
            }
        }
    }
    return null;
}

const MarkdownRepoContext = createContext<string | null>(null);

function AttachmentFallback({ href, name }: { href: string; name?: string }) {
    const fallbackLabel =
        name ?? (isGraphiteUserAttachmentUrl(href) ? "Open attachment on Graphite" : "Open attachment on GitHub");

    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer noopener ugc"
            className="my-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground no-underline hover:bg-muted/70"
        >
            <Film className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{fallbackLabel}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </a>
    );
}

/** Graphite PR media — direct CDN URL, no GitHub markdown API resolution. */
function GraphiteAttachmentMedia({ src, name, kind }: { src: string; name?: string; kind: "image" | "video" }) {
    const [failed, setFailed] = useState(false);

    if (failed) {
        return <AttachmentFallback href={src} name={name} />;
    }

    if (kind === "video") {
        return (
            <div className="my-2 overflow-hidden rounded-md border bg-muted/20">
                {name ? (
                    <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">{name}</div>
                ) : null}
                <video
                    src={src}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-[min(480px,70vh)] w-full max-w-full bg-muted"
                    onError={() => setFailed(true)}
                >
                    <a href={src} target="_blank" rel="noreferrer noopener ugc">
                        {src}
                    </a>
                </video>
            </div>
        );
    }

    return (
        <img
            src={src}
            alt=""
            loading="lazy"
            className="my-2 max-h-[min(480px,70vh)] max-w-full rounded-md"
            onError={() => setFailed(true)}
        />
    );
}

/**
 * Private GitHub media: `user-attachments` (markdown API → signed CDN) or Easy Review
 * `blob/…?raw=true` uploads (Contents `download_url`). Cookies are not sent on cross-origin
 * `<img>`/`<video>`, so bare github.com URLs fail for private repos — wait for a signed URL
 * (or reuse one from GitHub HTML) before mounting media.
 */
function alreadySignedAttachment(src: string, preferredKind?: "image" | "video"): ResolvedGithubAttachment | null {
    if (isGithubUserAttachmentUrl(src) || isGithubPrivateMediaUrl(src)) {
        return null;
    }
    if (!isAllowedResolvedAttachmentSrc(src)) {
        return null;
    }
    return {
        kind:
            preferredKind ?? mediaKindFromLinkText(src) ?? (/\.(mp4|webm|mov)(?:\?|$)/i.test(src) ? "video" : "image"),
        src,
    };
}

function GithubAttachmentMedia({
    src,
    preferredKind,
    initialResolved = null,
}: {
    src: string;
    preferredKind?: "image" | "video";
    /** Signed CDN URL already present in GitHub’s HTML (thumbnail wrapper). */
    initialResolved?: ResolvedGithubAttachment | null;
}) {
    const repository = useContext(MarkdownRepoContext);
    const session = useOptionalSession();
    const signed = initialResolved ?? alreadySignedAttachment(src, preferredKind);
    const [resolved, setResolved] = useState<ResolvedGithubAttachment | null>(signed);
    const isUserAttachment = isGithubUserAttachmentUrl(src);
    const needsAuthResolve = isUserAttachment || isGithubRepoBlobRawUrl(src);
    const canResolve = Boolean(session && (!isUserAttachment || repository));
    const [status, setStatus] = useState<"loading" | "ready" | "failed">(() => {
        if (signed) {
            return "ready";
        }
        return canResolve && needsAuthResolve ? "loading" : "failed";
    });
    const [retried, setRetried] = useState(false);

    useEffect(() => {
        if (signed && !retried) {
            return;
        }
        if (!needsAuthResolve) {
            if (signed) {
                setStatus("ready");
            } else {
                setStatus("failed");
            }
            return;
        }
        if (!session) {
            setStatus(signed ? "ready" : "failed");
            return;
        }
        if (isUserAttachment && !repository) {
            setStatus(signed ? "ready" : "failed");
            return;
        }

        let cancelled = false;
        if (!signed || retried) {
            setStatus("loading");
        }
        const resolve = isUserAttachment
            ? session.resolveUserAttachment(repository!, src)
            : session.resolveRepoBlobMedia(src);

        void resolve
            .then((next) => {
                if (cancelled) {
                    return;
                }
                if (next) {
                    setResolved(next);
                    setStatus("ready");
                    return;
                }
                if (!signed) {
                    setStatus("failed");
                }
            })
            .catch(() => {
                if (!cancelled && !signed) {
                    setStatus("failed");
                }
            });

        return () => {
            cancelled = true;
        };
    }, [session, repository, src, retried, isUserAttachment, signed, needsAuthResolve]);

    if (status === "failed") {
        return <AttachmentFallback href={src} name={resolved?.name} />;
    }

    if (status === "loading" || !resolved) {
        return (
            <div
                className="my-2 h-40 max-w-full animate-pulse rounded-md bg-muted/50"
                aria-busy="true"
                aria-label="Loading attachment"
            />
        );
    }

    const mediaSrc = resolved.src;
    const kind = resolved.kind ?? preferredKind ?? "image";

    if (kind === "video") {
        return (
            <div className="my-2 overflow-hidden rounded-md border bg-muted/20">
                {resolved.name ? (
                    <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
                        {resolved.name}
                    </div>
                ) : null}
                <video
                    key={mediaSrc}
                    src={mediaSrc}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-[min(480px,70vh)] w-full max-w-full bg-muted"
                    onError={() => {
                        if (!retried && canResolve) {
                            setRetried(true);
                            return;
                        }
                        setStatus("failed");
                    }}
                >
                    <a href={src} target="_blank" rel="noreferrer noopener ugc">
                        {src}
                    </a>
                </video>
            </div>
        );
    }

    return (
        <img
            key={mediaSrc}
            src={mediaSrc}
            alt={resolved.name ?? ""}
            loading="lazy"
            className="my-2 max-h-[min(480px,70vh)] max-w-full rounded-md"
            onError={() => {
                if (!retried && canResolve) {
                    setRetried(true);
                    return;
                }
                setStatus("failed");
            }}
        />
    );
}

function MarkdownVideo({ src, ...props }: ComponentPropsWithoutRef<"video">) {
    const [failed, setFailed] = useState(false);
    if (failed || typeof src !== "string") {
        return typeof src === "string" ? <AttachmentFallback href={src} /> : null;
    }
    return (
        <video
            src={src}
            controls
            playsInline
            preload="metadata"
            className="my-2 max-h-[min(480px,70vh)] w-full max-w-full rounded-md bg-muted"
            onError={() => setFailed(true)}
            {...props}
        />
    );
}

const components = {
    a: ({ href, children, className, ...props }: ComponentPropsWithoutRef<"a">) => {
        const linkText = linkChildrenText(children);
        if (shouldEmbedGraphiteAttachment(href)) {
            const parsed = parseGraphiteUserAttachmentUrl(href);
            const label = attachmentLabelFromLinkText(linkText);
            return (
                <GraphiteAttachmentMedia
                    src={href!}
                    name={label || parsed?.name}
                    kind={parsed?.kind ?? mediaKindFromLinkText(linkText) ?? "video"}
                />
            );
        }
        if (
            shouldEmbedGithubAttachment(href, linkText) ||
            (isGithubUserAttachmentUrl(href) && linkContainsEmbeddedMedia(children))
        ) {
            return (
                <GithubAttachmentMedia
                    src={href!}
                    preferredKind={mediaKindFromLinkText(linkText) ?? undefined}
                    initialResolved={firstResolvedMediaFromChildren(children)}
                />
            );
        }

        return (
            <a
                href={href}
                target="_blank"
                rel="noreferrer noopener ugc"
                className={cn(isGithubUserMentionHref(href) && "font-semibold", className)}
                {...props}
            >
                {children}
            </a>
        );
    },
    strong: ({ children, className, ...props }: ComponentPropsWithoutRef<"strong">) => (
        <strong className={cn("font-semibold", className)} {...props}>
            {children}
        </strong>
    ),
    pre: ({ children }: ComponentPropsWithoutRef<"pre">) => {
        const suggestion = fencedCodeFromPre(children, "suggestion");
        if (suggestion !== null) {
            return <SuggestionBlock code={suggestion} />;
        }

        const diff = fencedCodeFromPre(children, "diff");
        if (diff !== null) {
            return <DiffFenceBlock code={diff} />;
        }

        const mermaid = fencedCodeFromPre(children, "mermaid");
        if (mermaid !== null) {
            return (
                <Suspense
                    fallback={
                        <div
                            className="my-3 min-h-24 animate-pulse rounded-md border bg-muted/40 not-prose"
                            aria-busy="true"
                            aria-label="Loading diagram"
                        />
                    }
                >
                    <MermaidDiagram code={mermaid} />
                </Suspense>
            );
        }

        const codeChild = codeChildFromPre(children);
        const code = String(codeChild?.props.children ?? "").replace(/\n$/, "");
        const language = /\blanguage-([^\s]+)/.exec(codeChild?.props.className ?? "")?.[1] ?? "";
        // Bot “prompt” fences are prose-like — wrap instead of a wide monospace strip.
        const wrap = language === "" || language === "text" || language === "markdown";

        return <CodeFenceBlock code={code} wrap={wrap} />;
    },
    code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
        const isBlock = /\blanguage-/.test(className ?? "");
        if (isBlock) {
            return (
                <code className={cn("font-mono text-[12px] text-foreground", className)} {...props}>
                    {children}
                </code>
            );
        }

        return (
            <code
                className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground", className)}
                {...props}
            >
                {children}
            </code>
        );
    },
    // Match GitHub: bare disclosure row (ignore bot border/bg classes on details/summary).
    details: ({ className: _className, children, ...props }: ComponentPropsWithoutRef<"details">) => (
        <details className="my-1 border-0 bg-transparent p-0 text-foreground shadow-none open:my-2" {...props}>
            {children}
        </details>
    ),
    summary: ({ className: _className, children, ...props }: ComponentPropsWithoutRef<"summary">) => (
        <summary
            className="cursor-pointer list-inside border-0 bg-transparent py-0.5 font-medium text-foreground shadow-none select-none marker:text-muted-foreground"
            {...props}
        >
            {children}
        </summary>
    ),
    // Prose defaults give `<hr>` a large vertical margin; keep it close to GitHub comments.
    hr: () => <hr className="my-3 border-border" />,
    // Empty paragraphs (from bots / leftover blank lines) still eat typography margins.
    p: ({ children, ...props }: ComponentPropsWithoutRef<"p">) => {
        if (isBlankChildren(children)) {
            return null;
        }
        return <p {...props}>{children}</p>;
    },
    img: ({
        src,
        alt,
        width: _width,
        height: _height,
        style: _style,
        className,
        ...props
    }: ComponentPropsWithoutRef<"img">) => {
        if (!isAllowedMarkdownImageSrc(src)) {
            return null;
        }
        if (isGithubPrivateMediaUrl(src) && typeof src === "string") {
            return <GithubAttachmentMedia src={src} preferredKind={mediaKindFromLinkText(alt ?? "") ?? undefined} />;
        }
        return (
            <img
                src={src}
                alt={alt ?? ""}
                loading="lazy"
                referrerPolicy="no-referrer"
                className={cn("my-2 max-h-[min(480px,70vh)] max-w-full rounded-md", className)}
                {...props}
            />
        );
    },
    video: ({ src, ...props }: ComponentPropsWithoutRef<"video">) => {
        if (!isAllowedMarkdownImageSrc(typeof src === "string" ? src : undefined)) {
            return null;
        }
        if (isGithubPrivateMediaUrl(typeof src === "string" ? src : undefined) && typeof src === "string") {
            return <GithubAttachmentMedia src={src} />;
        }
        return <MarkdownVideo src={typeof src === "string" ? src : undefined} {...props} />;
    },
    input: ({ type, ...props }: ComponentPropsWithoutRef<"input">) => {
        if (type === "checkbox") {
            return <MarkdownCheckbox {...props} />;
        }
        return null;
    },
};

function isBlankChildren(children: ReactNode): boolean {
    const parts = Children.toArray(children);
    if (parts.length === 0) {
        return true;
    }
    return parts.every((part) => {
        if (typeof part === "string") {
            return part.replace(/\u00a0/g, " ").trim() === "";
        }
        if (typeof part === "number") {
            return false;
        }
        if (isValidElement<{ children?: ReactNode; src?: unknown }>(part)) {
            if (part.type === "br") {
                return true;
            }
            // Self-closing media / controls are real content (an image-only paragraph is not blank).
            if (part.type === "img" || part.type === "video" || part.type === "hr" || part.type === "input") {
                return false;
            }
            // Custom media hosts (e.g. GithubAttachmentMedia) pass `src` and have no text children.
            if (part.props.src != null) {
                return false;
            }
            return isBlankChildren(part.props.children);
        }
        return false;
    });
}

/**
 * A body written on GitHub links to its own repository with paths like `docs/setup.md`. Left
 * alone those resolve against the Easy Review origin, so they are re-pointed at GitHub first —
 * after the default transform, which is what refuses `javascript:` and friends.
 */
function resolveAgainst(base: string) {
    return (url: string): string => {
        const safe = defaultUrlTransform(url);

        if (!safe || safe.startsWith("#")) {
            return safe;
        }

        try {
            return new URL(safe, base).toString();
        } catch {
            return safe;
        }
    };
}

/** GitHub-flavored markdown for PR bodies and comments (alerts, details, safe HTML). */
export const Markdown = memo(function Markdown({
    source,
    baseUrl,
    suggestionOriginal = null,
    suggestionStartLine = null,
    suggestionLine = null,
    suggestionApply = null,
    onToggleTask = null,
}: {
    source: string;
    baseUrl: string;
    /** Original line(s) a ` ```suggestion ` block replaces — enables red/green diff. */
    suggestionOriginal?: string | null;
    /** First line of the replaced range; inferred from `suggestionLine` when omitted. */
    suggestionStartLine?: number | null;
    suggestionLine?: number | null;
    /** When set, suggestion fences show Apply / batch actions. */
    suggestionApply?: SuggestionApplyTarget | null;
    /** When set, GitHub task-list checkboxes are clickable. */
    onToggleTask?: ((index: number, checked: boolean) => void) | null;
}) {
    const urlTransform = useMemo(() => resolveAgainst(baseUrl), [baseUrl]);
    const prepared = useMemo(() => prepareMarkdownSource(source), [source]);
    const suggestionContext = useMemo(() => {
        const original = suggestionOriginal ?? null;
        const end = suggestionLine ?? null;
        const removedCount =
            original == null || original.length === 0 ? 0 : original.replace(/\n$/, "").split("\n").length;
        const start =
            suggestionStartLine ?? (end != null && removedCount > 0 ? Math.max(1, end - removedCount + 1) : end);

        return { original, startLine: start, endLine: end, apply: suggestionApply };
    }, [suggestionOriginal, suggestionStartLine, suggestionLine, suggestionApply]);

    let taskIndex = 0;
    const taskList: TaskListContextValue = {
        onToggle: onToggleTask,
        nextIndex: () => {
            const current = taskIndex;
            taskIndex += 1;
            return current;
        },
    };

    return (
        <SuggestionContext.Provider value={suggestionContext}>
            <MarkdownRepoContext.Provider value={repositoryFromGithubBaseUrl(baseUrl)}>
                <TaskListContext.Provider value={taskList}>
                    <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-p:my-2 prose-hr:my-3 prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-strong:text-foreground [&_.graphite__hidden]:hidden [&_li:has(>input[type=checkbox])]:list-none [&_ul:has(li>input[type=checkbox])]:list-none [&_ul:has(li>input[type=checkbox])]:pl-0">
                        <ReactMarkdown
                            remarkPlugins={remarkPlugins}
                            rehypePlugins={rehypePlugins}
                            components={components}
                            urlTransform={urlTransform}
                        >
                            {prepared}
                        </ReactMarkdown>
                    </div>
                </TaskListContext.Provider>
            </MarkdownRepoContext.Provider>
        </SuggestionContext.Provider>
    );
});
