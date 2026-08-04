import { describe, expect, it } from "vitest";

import { rewriteUserAttachmentsFromHtml } from "#/lib/rewrite-user-attachments.ts";

describe("rewriteUserAttachmentsFromHtml", () => {
    it("replaces user-attachments markdown urls with signed CDN urls from bodyHTML", () => {
        const markdownBody = `Test image
![image](https://github.com/user-attachments/assets/714215c1-e994-4c69-be20-2276c558f7c3)
test again
![image](https://github.com/user-attachments/assets/3f2c170a-d0c3-4ac7-a9e5-ea13bf71a5bc)`;
        const htmlBody = `
<p dir="auto">Test image</p><p dir="auto"><a target="_blank" rel="noopener noreferrer" href="https://private-user-images.githubusercontent.com/38270282/445632993-714215c1-e994-4c69-be20-2276c558f7c3.png?jwt=TEST"><img src="https://private-user-images.githubusercontent.com/38270282/445632993-714215c1-e994-4c69-be20-2276c558f7c3.png?jwt=TEST" alt="image" style="max-width: 100%;"></a></p>
<p dir="auto">test again</p>
<p dir="auto"><a target="_blank" rel="noopener noreferrer" href="https://private-user-images.githubusercontent.com/38270282/445689518-3f2c170a-d0c3-4ac7-a9e5-ea13bf71a5bc.png?jwt=TEST"><img src="https://private-user-images.githubusercontent.com/38270282/445689518-3f2c170a-d0c3-4ac7-a9e5-ea13bf71a5bc.png?jwt=TEST" alt="image" style="max-width: 100%;"></a></p>`;

        expect(rewriteUserAttachmentsFromHtml(markdownBody, htmlBody)).toBe(`Test image
![image](https://private-user-images.githubusercontent.com/38270282/445632993-714215c1-e994-4c69-be20-2276c558f7c3.png?jwt=TEST)
test again
![image](https://private-user-images.githubusercontent.com/38270282/445689518-3f2c170a-d0c3-4ac7-a9e5-ea13bf71a5bc.png?jwt=TEST)`);
    });

    it("rewrites named screenshot links used in review comments", () => {
        const uuid = "0682c898-4e3a-4209-a711-54519406d6a8";
        const markdown = `[Capture d'écran 2026-08-04 à 12.02.08.png](https://github.com/user-attachments/assets/${uuid})`;
        const signed = `https://private-user-images.githubusercontent.com/1/99-${uuid}.png?jwt=abc`;
        const html = `<p><a href="${signed}"><img src="${signed}" alt="Capture"></a></p>`;

        expect(rewriteUserAttachmentsFromHtml(markdown, html)).toBe(
            `[Capture d'écran 2026-08-04 à 12.02.08.png](${signed})`,
        );
    });

    it("leaves markdown unchanged when bodyHTML has no matching asset", () => {
        const markdown = "![x](https://github.com/user-attachments/assets/714215c1-e994-4c69-be20-2276c558f7c3)";
        expect(rewriteUserAttachmentsFromHtml(markdown, "<p>no images</p>")).toBe(markdown);
    });

    it("leaves markdown unchanged when bodyHTML is missing", () => {
        const markdown = "![x](https://github.com/user-attachments/assets/714215c1-e994-4c69-be20-2276c558f7c3)";
        expect(rewriteUserAttachmentsFromHtml(markdown, null)).toBe(markdown);
    });
});
