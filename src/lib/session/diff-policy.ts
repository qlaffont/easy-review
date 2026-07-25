import type { FileStubReason } from "#/lib/session/types.ts";

/** Blobs larger than this are stubbed unless the reviewer opts in. */
export const HUGE_FILE_BYTES = 512 * 1024;

/** Diffs longer than this are capped after a successful load so the tab stays responsive. */
export const MAX_RENDERED_DIFF_LINES = 4_000;

/**
 * Paths that almost never repay a first look. Matching here means the Review Changes view shows
 * a stub instead of fetching the blob — "Load anyway" still works.
 */
const GENERATED_NAME_PATTERN =
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|bun\.lockb|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum|Podfile\.lock|.*\.min\.(js|css)|.*\.bundle\.js|.*\.map)$/i;

const GENERATED_DIR_PATTERN =
    /(^|\/)(dist|build|out|coverage|vendor|\.next|node_modules|__snapshots__|generated|codegen)(\/|$)/i;

/** Extensions Git itself would rarely show as a line diff. */
const BINARY_EXTENSION_PATTERN =
    /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|bz2|xz|7z|rar|wasm|woff2?|ttf|otf|eot|mp3|mp4|mov|webm|avi|psd|ai|sketch|fig|exe|dll|so|dylib|class|o|a)$/i;

export function isLikelyGeneratedPath(path: string): boolean {
    return GENERATED_NAME_PATTERN.test(path) || GENERATED_DIR_PATTERN.test(path);
}

export function isLikelyBinaryPath(path: string): boolean {
    return BINARY_EXTENSION_PATTERN.test(path);
}

/** Stub decided from the path alone, before any blob is fetched. */
export function stubForPath(path: string): FileStubReason | null {
    if (isLikelyBinaryPath(path)) {
        return "binary";
    }

    if (isLikelyGeneratedPath(path)) {
        return "generated";
    }

    return null;
}

/** A buffer with a NUL byte is treated as binary — matching what Git itself does. */
export function isBinaryContent(bytes: Uint8Array): boolean {
    const sample = bytes.subarray(0, Math.min(bytes.length, 8_000));

    for (const byte of sample) {
        if (byte === 0) {
            return true;
        }
    }

    // High ratio of bytes outside printable ASCII / common UTF-8 → probably not source text.
    let suspicious = 0;

    for (const byte of sample) {
        if (byte < 7 || (byte > 14 && byte < 32 && byte !== 27)) {
            suspicious++;
        }
    }

    return sample.length > 0 && suspicious / sample.length > 0.3;
}

export function stubForBlob(bytes: Uint8Array, force: boolean): FileStubReason | null {
    if (isBinaryContent(bytes)) {
        return "binary";
    }

    if (!force && bytes.byteLength > HUGE_FILE_BYTES) {
        return "huge";
    }

    return null;
}
