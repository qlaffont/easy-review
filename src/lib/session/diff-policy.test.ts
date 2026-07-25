import { describe, expect, it } from "vitest";

import { buildFileDiff } from "#/lib/session/build-file-diff.ts";
import { HUGE_FILE_BYTES, isLikelyGeneratedPath, stubForPath } from "#/lib/session/diff-policy.ts";

function bytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

describe("stubForPath", () => {
    it("flags lockfiles and build output as generated", () => {
        expect(stubForPath("package-lock.json")).toBe("generated");
        expect(stubForPath("pnpm-lock.yaml")).toBe("generated");
        expect(stubForPath("dist/app.js")).toBe("generated");
        expect(stubForPath("src/app.min.js")).toBe("generated");
        expect(stubForPath("src/app.ts")).toBeNull();
    });

    it("flags common binary extensions before any blob is fetched", () => {
        expect(stubForPath("assets/logo.png")).toBe("binary");
        expect(stubForPath("font.woff2")).toBe("binary");
    });

    it("exposes the same rule through isLikelyGeneratedPath", () => {
        expect(isLikelyGeneratedPath("yarn.lock")).toBe(true);
        expect(isLikelyGeneratedPath("src/index.ts")).toBe(false);
    });
});

describe("buildFileDiff", () => {
    it("produces added and removed lines for a text change", () => {
        const diff = buildFileDiff({
            path: "src/a.ts",
            before: bytes("one\ntwo\n"),
            after: bytes("one\nthree\n"),
        });

        expect(diff.stub).toBeNull();
        expect(diff.lines.some((line) => line.kind === "del" && line.text === "two")).toBe(true);
        expect(diff.lines.some((line) => line.kind === "add" && line.text === "three")).toBe(true);
    });

    it("stubs binary content unless the reviewer has no escape — binary always refuses", () => {
        const binary = new Uint8Array([0x00, 0x01, 0x02, 0xff]);
        expect(buildFileDiff({ path: "a.bin", before: null, after: binary }).stub).toBe("binary");
        expect(buildFileDiff({ path: "a.bin", before: null, after: binary }, { force: true }).stub).toBe("binary");
    });

    it("stubs huge files until force is set", () => {
        const huge = new Uint8Array(HUGE_FILE_BYTES + 1).fill(65);
        expect(buildFileDiff({ path: "big.txt", before: null, after: huge }).stub).toBe("huge");
        expect(buildFileDiff({ path: "big.txt", before: null, after: huge }, { force: true }).stub).toBeNull();
    });
});
