/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";

import { renderMermaidSvg } from "#/components/pr/mermaid-diagram.tsx";

const INVALID_SEQUENCE = `sequenceDiagram
  participant A
  A-> this is not a valid arrow
`;

afterEach(() => {
    document.body.replaceChildren();
});

describe("renderMermaidSvg", () => {
    it("does not inject mermaid's syntax-error diagram into the document body", async () => {
        await expect(renderMermaidSvg(INVALID_SEQUENCE, "mermaid-test-invalid", false)).rejects.toThrow();

        expect(document.body.innerHTML).not.toContain("Syntax error in text");
        expect(document.body.querySelector(".error-icon")).toBeNull();
        expect(document.getElementById("dmermaid-test-invalid")).toBeNull();
    });
});
