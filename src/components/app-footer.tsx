const SOURCE_REPO_URL = "https://github.com/qlaffont/easy-review";
const AUTHOR_URL = "https://qlaffont.com";

export function AppFooter() {
    return (
        <footer className="border-t bg-background px-4 py-4 text-center text-xs text-muted-foreground">
            <p className="text-pretty">
                Source code available on{" "}
                <a
                    href={SOURCE_REPO_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground/80 underline-offset-4 hover:text-foreground hover:underline"
                >
                    GitHub
                </a>
                {" · "}
                Vibecoded by{" "}
                <a
                    href={AUTHOR_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground/80 underline-offset-4 hover:text-foreground hover:underline"
                >
                    Quentin Laffont
                </a>
            </p>
        </footer>
    );
}
