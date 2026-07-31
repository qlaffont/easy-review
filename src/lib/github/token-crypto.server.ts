import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import { getGithubServerEnv } from "#/lib/github/env.server.ts";

const SESSION_FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(): Buffer {
    const material = process.env.GITHUB_SESSION_SECRET?.trim() || getGithubServerEnv().GITHUB_CLIENT_SECRET;
    return createHmac("sha256", "easy-review-github-session-v1").update(material).digest();
}

/** AES-256-GCM seal for httpOnly cookie payloads (refresh tokens, expiry metadata). */
export function sealGithubSessionPayload(payload: string): string {
    const key = encryptionKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([Buffer.from([SESSION_FORMAT_VERSION]), iv, tag, ciphertext]).toString("base64url");
}

export function openGithubSessionPayload(sealed: string): string | null {
    try {
        const bytes = Buffer.from(sealed, "base64url");
        if (bytes.length <= 1 + IV_BYTES + TAG_BYTES || bytes[0] !== SESSION_FORMAT_VERSION) {
            return null;
        }

        const iv = bytes.subarray(1, 1 + IV_BYTES);
        const tag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
        const ciphertext = bytes.subarray(1 + IV_BYTES + TAG_BYTES);

        const key = encryptionKey();
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return plaintext.toString("utf8");
    } catch {
        return null;
    }
}
