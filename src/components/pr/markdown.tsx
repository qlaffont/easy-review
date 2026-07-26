import { memo, useMemo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { remarkAlert } from "remark-github-blockquote-alert";

import { prepareMarkdownSource } from "#/lib/markdown-source.ts";
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

const remarkPlugins = [remarkGfm, remarkAlert];
const rehypePlugins: Array<typeof rehypeRaw | [typeof rehypeSanitize, typeof sanitizeSchema]> = [
    rehypeRaw,
    [rehypeSanitize, sanitizeSchema],
];

const components = {
    a: ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => (
        <a href={href} target="_blank" rel="noreferrer noopener ugc" {...props}>
            {children}
        </a>
    ),
    details: ({ className, children, ...props }: ComponentPropsWithoutRef<"details">) => (
        <details className={cn("my-3 rounded-md border px-3 py-2", className)} {...props}>
            {children}
        </details>
    ),
    summary: ({ className, children, ...props }: ComponentPropsWithoutRef<"summary">) => (
        <summary className={cn("cursor-pointer font-medium select-none", className)} {...props}>
            {children}
        </summary>
    ),
    input: ({ type, ...props }: ComponentPropsWithoutRef<"input">) => {
        if (type === "checkbox") {
            return <input type="checkbox" disabled className="mr-1.5 align-middle" {...props} />;
        }
        return null;
    },
};

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
export const Markdown = memo(function Markdown({ source, baseUrl }: { source: string; baseUrl: string }) {
    const urlTransform = useMemo(() => resolveAgainst(baseUrl), [baseUrl]);
    const prepared = useMemo(() => prepareMarkdownSource(source), [source]);

    return (
        <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:text-xs prose-code:before:content-none prose-code:after:content-none">
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={components}
                urlTransform={urlTransform}
            >
                {prepared}
            </ReactMarkdown>
        </div>
    );
});
