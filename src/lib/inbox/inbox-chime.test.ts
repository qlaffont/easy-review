import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const contexts: FakeAudioContext[] = [];

class FakeAudioContext {
    currentTime = 5;
    destination = {};
    frequencies: number[] = [];
    resume = vi.fn(() => Promise.resolve());
    suspend = vi.fn(() => Promise.resolve());

    constructor() {
        contexts.push(this);
    }

    createOscillator() {
        const oscillator = {
            frequency: { value: 0 },
            connect: vi.fn(),
            start: vi.fn(() => this.frequencies.push(oscillator.frequency.value)),
            stop: vi.fn(),
        };
        return oscillator;
    }

    createGain() {
        return {
            connect: vi.fn(),
            gain: {
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
                exponentialRampToValueAtTime: vi.fn(),
            },
        };
    }
}

const listeners = new Map<string, () => void>();
const stored = new Map<string, string>();

function interact() {
    listeners.get("click")?.();
}

/** A fresh module, as in another tab or after a reload: no audio context, same localStorage. */
async function openTab() {
    vi.resetModules();
    return import("#/lib/inbox/inbox-chime.ts");
}

beforeEach(() => {
    vi.useFakeTimers();
    contexts.length = 0;
    listeners.clear();
    stored.clear();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("window", {
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
        setTimeout,
        localStorage: {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => stored.set(key, value),
        },
    });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("inbox chime", () => {
    it("stays silent and leaves the chime to other tabs until the user interacts", async () => {
        const { armInboxChime, playInboxChime } = await openTab();
        armInboxChime();

        await playInboxChime(["acme/api#1"]);

        expect(contexts).toHaveLength(0);
        expect(stored.size).toBe(0);
    });

    it("plays the four notes once armed, then suspends the audio context", async () => {
        const { armInboxChime, playInboxChime } = await openTab();
        armInboxChime();
        interact();
        await vi.advanceTimersByTimeAsync(0);
        const audio = contexts[0];

        await playInboxChime(["acme/api#1"]);

        expect(audio?.frequencies.slice(0, 2)).toEqual([587.33, 587.33 * 4]);
        expect(audio?.frequencies).toHaveLength(8);

        audio?.suspend.mockClear();
        await vi.advanceTimersByTimeAsync(1500);
        expect(audio?.suspend).toHaveBeenCalledOnce();
    });

    it("chimes once per pull request across tabs", async () => {
        const firstTab = await openTab();
        firstTab.armInboxChime();
        interact();
        await firstTab.playInboxChime(["acme/api#1"]);

        const secondTab = await openTab();
        secondTab.armInboxChime();
        interact();
        await secondTab.playInboxChime(["acme/api#1"]);

        expect(contexts[0]?.frequencies).toHaveLength(8);
        expect(contexts[1]?.frequencies).toHaveLength(0);

        await secondTab.playInboxChime(["acme/api#1", "acme/api#2"]);
        expect(contexts[1]?.frequencies).toHaveLength(8);
    });

    it("chimes again for a pull request that returns after an hour", async () => {
        const { armInboxChime, playInboxChime } = await openTab();
        armInboxChime();
        interact();
        await playInboxChime(["acme/api#1"]);

        vi.setSystemTime(Date.now() + 60 * 60 * 1000);
        await playInboxChime(["acme/api#1"]);

        expect(contexts[0]?.frequencies).toHaveLength(16);
    });

    it("does not throw when storage is unusable", async () => {
        const { armInboxChime, playInboxChime } = await openTab();
        armInboxChime();
        interact();
        stored.set("easy-review:inbox-chimed:v1", "not json");

        await expect(playInboxChime(["acme/api#1"])).resolves.toBeUndefined();
    });
});
