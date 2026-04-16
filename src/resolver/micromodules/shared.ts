import { createHash } from "node:crypto";
import type { SourceType } from "../contracts.js";

function stableId(prefix: string, value: string): string {
    const hash = createHash("sha1").update(value).digest("hex").slice(0, 16);
    return `${prefix}:${hash}`;
}

function parseJsonFromMixedOutput(output: string): unknown {
    const text = output.trim();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        // continue
    }

    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line) {
            continue;
        }

        if (line.startsWith("{") || line.startsWith("[")) {
            try {
                return JSON.parse(line);
            } catch {
                // continue
            }
        }
    }

    return null;
}

function extractEntries(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (!payload || typeof payload !== "object") {
        return [];
    }

    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.entries)) return obj.entries;
    if (Array.isArray(obj.tracks)) return obj.tracks;
    if (Array.isArray(obj.items)) return obj.items;
    return [obj];
}

function readString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function parseDurationMs(value: unknown): number | null {
    if (typeof value !== "number" && typeof value !== "string") {
        return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }
    if (numeric > 10_000) {
        return Math.floor(numeric);
    }
    return Math.floor(numeric * 1000);
}

function normalizeArtists(value: unknown): string[] | null {
    if (Array.isArray(value)) {
        const artists = value
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean);
        return artists.length > 0 ? artists : null;
    }

    if (typeof value === "string") {
        const artists = value.split(",").map((item) => item.trim()).filter(Boolean);
        return artists.length > 0 ? artists : null;
    }

    return null;
}

function safeUrl(value: string): URL | null {
    try {
        const parsed = new URL(value);
        if (!parsed.hostname) return null;
        return parsed;
    } catch {
        return null;
    }
}

function parseSpotifyInput(input: string): { kind: "track" | "album" | "playlist"; id: string } | null {
    const uriMatch = input.match(/^spotify:(track|album|playlist):([A-Za-z0-9]+)$/i);
    if (uriMatch) {
        const kindRaw = uriMatch[1]?.toLowerCase();
        const id = uriMatch[2]?.trim();
        if (!id) {
            return null;
        }
        if (kindRaw === "track" || kindRaw === "album" || kindRaw === "playlist") {
            return { kind: kindRaw, id };
        }
    }

    const url = safeUrl(input);
    if (!url) return null;
    if (!url.hostname.toLowerCase().endsWith("spotify.com")) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    const kindIndex = parts.findIndex(
        (part) => part === "track" || part === "album" || part === "playlist"
    );
    if (kindIndex < 0) {
        return null;
    }

    const kind = parts[kindIndex];
    const id = parts[kindIndex + 1];
    if (!kind || !id) {
        return null;
    }

    if (kind === "track" || kind === "album" || kind === "playlist") {
        return { kind, id };
    }
    return null;
}

function detectSourceType(input: string): SourceType {
    const spotify = parseSpotifyInput(input);
    if (spotify?.kind === "track") return "spotify_track";
    if (spotify?.kind === "album") return "spotify_album";
    if (spotify?.kind === "playlist") return "spotify_playlist";

    const url = safeUrl(input);
    if (!url) return "unknown";

    const hostname = url.hostname.toLowerCase();
    if (hostname === "youtu.be" || hostname.endsWith("youtube.com")) return "youtube";

    const mediaExtensions = [".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus", ".webm", ".mp4", ".mkv"];
    if (mediaExtensions.some((ext) => url.pathname.toLowerCase().endsWith(ext))) return "direct_url";

    if (url.protocol === "http:" || url.protocol === "https:") return "unknown";
    return "unknown";
}

function getCanonicalId(sourceType: SourceType, input: string, raw?: Record<string, unknown>): string | null {
    const spotify = parseSpotifyInput(input);
    if (spotify) {
        return `spotify:${spotify.kind}:${spotify.id}`;
    }

    if (sourceType === "youtube") {
        const direct = readString(raw?.id);
        if (direct) return `youtube:${direct}`;
        const url = safeUrl(input);
        if (!url) return null;
        if (url.hostname.toLowerCase() === "youtu.be") {
            const id = url.pathname.replace("/", "").trim();
            return id ? `youtube:${id}` : null;
        }
        const v = url.searchParams.get("v")?.trim();
        return v ? `youtube:${v}` : null;
    }

    if (sourceType === "direct_url") {
        return `url:${input}`;
    }

    return null;
}

export {
    stableId,
    parseJsonFromMixedOutput,
    extractEntries,
    readString,
    parseDurationMs,
    normalizeArtists,
    safeUrl,
    parseSpotifyInput,
    detectSourceType,
    getCanonicalId
};
