import { Check, Copy, PencilLine } from "lucide-react";
import {
    Children,
    createContext,
    isValidElement,
    memo,
    useContext,
    useMemo,
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
import { prepareMarkdownSource } from "#/lib/markdown-source.ts";
import { remarkBoldMentions } from "#/lib/remark-bold-mentions.ts";
import { notifyCopied, notifyError } from "#/lib/toast.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Allow the same structural HTML GitHub keeps in issue/PR bodies, plus alert markup
 * produced by `remark-github-blockquote-alert` (div/svg/path + classes).
 */
const sanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), "svg", "path", "section"],
    attributes: {
        ...defaultSchema.attributes,
        div: [...(defaultSchema.attributes?.div ?? []), ["className"], "class", "dir"],
        p: [...(defaultSchema.attributes?.p ?? []), ["className"], "class", "dir"],
        span: [...(defaultSchema.attributes?.span ?? []), ["className"], "class"],
        section: [["className"], "class", "dir"],
        details: [...(defaultSchema.attributes?.details ?? []), "open", ["className"], "class"],
        summary: [...(defaultSchema.attributes?.summary ?? []), ["className"], "class"],
        svg: ["className", "class", "viewBox", "width", "height", "ariaHidden", "aria-hidden", "fill", "role", "xmlns"],
        path: ["d", "fill", "fillRule", "fill-rule", "clipRule", "clip-rule"],
        input: [...(defaultSchema.attributes?.input ?? []), "disabled", "checked", "type"],
    },
};

const remarkPlugins = [remarkGfm, remarkAlert, remarkBoldMentions];
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

const components = {
    a: ({ href, children, className, ...props }: ComponentPropsWithoutRef<"a">) => (
        <a
            href={href}
            target="_blank"
            rel="noreferrer noopener ugc"
            className={cn(isGithubUserMentionHref(href) && "font-semibold", className)}
            {...props}
        >
            {children}
        </a>
    ),
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
    input: ({ type, ...props }: ComponentPropsWithoutRef<"input">) => {
        if (type === "checkbox") {
            return <input type="checkbox" disabled className="mr-1.5 align-middle" {...props} />;
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
        if (isValidElement<{ children?: ReactNode }>(part)) {
            if (part.type === "br") {
                return true;
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

    return (
        <SuggestionContext.Provider value={suggestionContext}>
            <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-p:my-2 prose-hr:my-3 prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-strong:text-foreground [&_li:has(>input[type=checkbox])]:list-none [&_ul:has(li>input[type=checkbox])]:list-none [&_ul:has(li>input[type=checkbox])]:pl-0">
                <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                    components={components}
                    urlTransform={urlTransform}
                >
                    {prepared}
                </ReactMarkdown>
            </div>
        </SuggestionContext.Provider>
    );
});
