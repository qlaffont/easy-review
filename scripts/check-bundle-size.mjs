#!/usr/bin/env node
/**
 * Fails CI when the production build exceeds size budgets.
 * Budgets target what ships in `.output` after `pnpm build`.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, ".output");
const publicDir = path.join(outputDir, "public");

/** Soft headroom over today's build (~6.5 MiB client with lazy Mermaid + curated Shiki langs). */
const BUDGETS = {
    clientPublicBytes: 7 * 1024 * 1024, // 7 MiB — static assets sent to browsers
    totalOutputBytes: 12 * 1024 * 1024, // 12 MiB — full deployable `.output`
    largestJsChunkBytes: 1024 * 1024, // 1 MiB — single client JS chunk
};

async function dirSize(dir) {
    let total = 0;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            total += await dirSize(full);
        } else if (entry.isFile()) {
            total += (await stat(full)).size;
        }
    }
    return total;
}

async function largestMatching(dir, predicate) {
    let largest = { path: null, size: 0 };
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const nested = await largestMatching(full, predicate);
            if (nested.size > largest.size) largest = nested;
        } else if (entry.isFile() && predicate(full)) {
            const size = (await stat(full)).size;
            if (size > largest.size) largest = { path: full, size };
        }
    }
    return largest;
}

function formatBytes(bytes) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
}

function check(label, actual, budget, detail = "") {
    const ok = actual <= budget;
    const suffix = detail ? ` (${detail})` : "";
    console.log(
        `${ok ? "✓" : "✗"} ${label}: ${formatBytes(actual)} / ${formatBytes(budget)}${suffix}`,
    );
    return ok;
}

async function main() {
    let clientPublic;
    let totalOutput;
    try {
        clientPublic = await dirSize(publicDir);
        totalOutput = await dirSize(outputDir);
    } catch (error) {
        console.error(
            "Missing `.output` — run `pnpm build` before `pnpm check:size`.",
        );
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }

    const largestJs = await largestMatching(
        publicDir,
        (filePath) => filePath.endsWith(".js"),
    );

    const results = [
        check("Client public assets", clientPublic, BUDGETS.clientPublicBytes),
        check("Total .output", totalOutput, BUDGETS.totalOutputBytes),
        check(
            "Largest client JS chunk",
            largestJs.size,
            BUDGETS.largestJsChunkBytes,
            largestJs.path ? path.relative(root, largestJs.path) : "none",
        ),
    ];

    if (results.some((ok) => !ok)) {
        console.error("\nBundle size budget exceeded.");
        process.exit(1);
    }

    console.log("\nBundle size OK.");
}

await main();
