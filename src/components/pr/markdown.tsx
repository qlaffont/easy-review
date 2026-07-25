import { memo, useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Pull request bodies are untrusted text from whoever opened them. `react-markdown` drops raw
 * HTML unless a plugin puts it back, so nothing here needs to sanitize by hand.
 */
const components = {
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <a href={href} target="_blank" rel="noreferrer noopener ugc">
            {children}
        </a>
    ),
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

export const Markdown = memo(function Markdown({ source, baseUrl }: { source: string; baseUrl: string }) {
    const urlTransform = useMemo(() => resolveAgainst(baseUrl), [baseUrl]);

    return (
        <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
                {source}
            </ReactMarkdown>
        </div>
    );
});
