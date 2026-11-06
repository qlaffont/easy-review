/**
 * Easy Review's own alert sound, played alongside desktop notifications so it can be told apart
 * from the operating system and other apps. Synthesized, so there is no audio file to ship.
 */

/** A short up-down-up figure in D major: most desktop alerts are one or two notes. */
const CHIME_NOTES = [
    { frequencyHz: 587.33, startS: 0, decayS: 0.35 }, // D5
    { frequencyHz: 880, startS: 0.11, decayS: 0.35 }, // A5
    { frequencyHz: 739.99, startS: 0.22, decayS: 0.35 }, // F#5
    { frequencyHz: 1174.66, startS: 0.33, decayS: 0.9 }, // D6
];

/** A fundamental plus a quick two-octave overtone gives the struck, woody tone of a marimba. */
const CHIME_PARTIALS = [
    { frequencyRatio: 1, level: 0.22, decayRatio: 1 },
    { frequencyRatio: 4, level: 0.05, decayRatio: 0.3 },
];

const CHIME_LENGTH_S = Math.max(...CHIME_NOTES.map((note) => note.startS + note.decayS));
const ATTACK_S = 0.004;
/** Exponential ramps cannot reach zero, so notes fade to this inaudible level. */
const SILENCE = 0.0001;

const CHIMED_STORAGE_KEY = "easy-review:inbox-chimed:v1";
const CHIME_MEMORY_MS = 60 * 60 * 1000;

let context: AudioContext | undefined;

/**
 * Browsers only let a page make sound after an interaction, and Safari only unlocks a context
 * started from one, so the context is created on the first click or key press. It stays suspended
 * between chimes to keep the audio device idle. Returns a cleanup for the listeners.
 */
export function armInboxChime(): () => void {
    function disarm() {
        window.removeEventListener("click", arm);
        window.removeEventListener("keydown", arm);
    }

    function arm() {
        disarm();
        context ??= new AudioContext();
        const armed = context;
        void armed
            .resume()
            .then(() => armed.suspend())
            .catch(() => {
                // Still locked: the next chime tries to resume it again.
            });
    }

    if (!context) {
        window.addEventListener("click", arm);
        window.addEventListener("keydown", arm);
    }
    return disarm;
}

/**
 * Every open tab detects the same pull request on its own timer, so remember what already chimed
 * across tabs. Returns whether any of these keys is new.
 */
function claimChime(keys: ReadonlyArray<string>, now: number): boolean {
    const stored = JSON.parse(window.localStorage.getItem(CHIMED_STORAGE_KEY) ?? "{}") as Record<string, number>;
    const recent = Object.fromEntries(Object.entries(stored).filter(([, at]) => now - at < CHIME_MEMORY_MS));
    const newKeys = keys.filter((key) => !(key in recent));

    for (const key of newKeys) {
        recent[key] = now;
    }
    window.localStorage.setItem(CHIMED_STORAGE_KEY, JSON.stringify(recent));

    return newKeys.length > 0;
}

function strikeNote(audio: AudioContext, frequencyHz: number, level: number, startAt: number, decayS: number): void {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const endAt = startAt + decayS;

    oscillator.frequency.value = frequencyHz;
    gain.gain.setValueAtTime(SILENCE, startAt);
    gain.gain.linearRampToValueAtTime(level, startAt + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(SILENCE, endAt);

    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(startAt);
    oscillator.stop(endAt);
}

/**
 * Play the chime once for these notification keys. Does nothing in a tab the user never interacted
 * with: such a tab cannot make sound, and must leave the chime to one that can.
 */
export async function playInboxChime(keys: ReadonlyArray<string>): Promise<void> {
    const audio = context;
    if (!audio) {
        return;
    }

    try {
        if (!claimChime(keys, Date.now())) {
            return;
        }

        await audio.resume();
        const startAt = audio.currentTime;
        for (const note of CHIME_NOTES) {
            for (const partial of CHIME_PARTIALS) {
                strikeNote(
                    audio,
                    note.frequencyHz * partial.frequencyRatio,
                    partial.level,
                    startAt + note.startS,
                    note.decayS * partial.decayRatio,
                );
            }
        }
        window.setTimeout(() => void audio.suspend(), CHIME_LENGTH_S * 1000);
    } catch {
        // The notification itself still shows; a missing sound is not worth surfacing.
    }
}
