import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ResolveCandidate, ResolveError, ResolveInput, ResolveResult, ResolvedEntry, SourceType } from "../resolver/contracts.js";
import type { ResolverClient } from "../resolver/client/ResolverClient.js";

const execFileAsync = promisify(execFile);

type SupportedResolveCode = ResolveError["code"];

class LocalResolverError extends Error {
    public readonly code: SupportedResolveCode;
    public readonly requestId: string | null;

    constructor(code: SupportedResolveCode, message: string, requestId: string | null) {
        super(message);
        this.name = "LocalResolverError";
        this.code = code;
        this.requestId = requestId;
    }
}

class LocalResolverService implements ResolverClient {
    private readonly timeoutMs: number;
    private readonly ytdlpBinary: string;
    private readonly spotiflacBinary: string;

    constructor(options: {
        timeoutMs?: number;
        ytdlpBinary?: string;
        spotiflacBinary?: string;
    } = {}) {
        this.timeoutMs = options.timeoutMs ?? parseInt(process.env.PROVIDER_TIMEOUT_MS || "15000", 10);
        this.ytdlpBinary = options.ytdlpBinary ?? resolveBinary("YTDLP_BIN", ".yt-dlp", "yt-dlp");
        this.spotiflacBinary = options.spotiflacBinary ?? resolveBinary("SPOTIFLAC_BIN", ".spotiflac", "spotiflac");
    }

    public async resolve(input: ResolveInput): Promise<ResolveResult> {
        const requestId = normalizeRequestId(input.requestId);
        const normalizedInput = input.input?.trim();

        if (!normalizedInput) {
            throw new LocalResolverError("INVALID_INPUT", "Field 'input' must be a non-empty string.", requestId);
        }

        const sourceType = detectSourceType(normalizedInput);
        const spotifySource =
            sourceType === "spotify_track" ||
            sourceType === "spotify_album" ||
            sourceType === "spotify_playlist";

        const primary = spotifySource
            ? () => this.resolveWithSpotiFlac(normalizedInput, sourceType)
            : () => this.resolveWithYtDlp(normalizedInput, sourceType);
        const fallback = spotifySource
            ? () => this.resolveWithYtDlp(normalizedInput, sourceType)
            : () => this.resolveWithSpotiFlac(normalizedInput, sourceType);

        let primaryError: unknown = null;
        let entries: ResolvedEntry[] = [];

        try {
            entries = await primary();
        } catch (error) {
            primaryError = error;
        }

        if (entries.length === 0) {
            try {
                entries = await fallback();
            } catch (fallbackError) {
                if (primaryError) {
                    throw normalizeProviderError(primaryError, requestId);
                }
                throw normalizeProviderError(fallbackError, requestId);
            }
        }

        if (entries.length === 0) {
            throw new LocalResolverError("NOT_FOUND", "No tracks were resolved for this input.", requestId);
        }

        return {
            requestId,
            sourceType,
            entries: entries.map((entry) => normalizeEntry(entry))
        };
    }

    private async resolveWithYtDlp(input: string, sourceType: SourceType): Promise<ResolvedEntry[]> {
        const args = ["--dump-single-json", "--no-warnings"];
        if (sourceType === "youtube") {
            args.push("--no-playlist");
        }
        args.push(input);

        const stdout = await this.runBinary(this.ytdlpBinary, args);
        const payload = parseJsonFromMixedOutput(stdout);
        if (!payload) {
            return [];
        }

        const rawEntries = extractEntries(payload);
        const entries: ResolvedEntry[] = [];

        for (let i = 0; i < rawEntries.length; i++) {
            const raw = rawEntries[i];
            if (!raw || typeof raw !== "object") {
                continue;
            }

            const rawObj = raw as Record<string, unknown>;
            const canonical = getCanonicalId(sourceType, input, rawObj);
            const entryId = stableId("entry", canonical ?? `${input}:${i}`);
            const streamUrl = readString(rawObj.url) ?? readString(rawObj.webpage_url);
            const artists = normalizeArtists(rawObj.artists)
                ?? normalizeArtists(rawObj.artist)
                ?? normalizeArtists(rawObj.uploader)
                ?? normalizeArtists(rawObj.channel)
                ?? [];

            entries.push({
                id: entryId,
                title: readString(rawObj.title),
                artists,
                durationMs: parseDurationMs(rawObj.duration),
                artworkUrl: readString(rawObj.thumbnail),
                originalInput: input,
                canonicalId: canonical,
                candidates: [
                    {
                        id: stableId("candidate", `${entryId}:ytdlp:stream`),
                        provider: "ytdlp",
                        kind: "stream",
                        quality: sourceType === "direct_url" ? "unknown" : "lossy",
                        url: streamUrl,
                        metadata: {
                            extractor: rawObj.extractor ?? null,
                            webpageUrl: rawObj.webpage_url ?? null
                        }
                    },
                    {
                        id: stableId("candidate", `${entryId}:ytdlp:download`),
                        provider: "ytdlp",
                        kind: "download",
                        quality: "lossy",
                        url: streamUrl,
                        metadata: {
                            extractor: rawObj.extractor ?? null
                        }
                    }
                ]
            });
        }

        return entries;
    }

    private async resolveWithSpotiFlac(input: string, sourceType: SourceType): Promise<ResolvedEntry[]> {
        if (
            sourceType !== "spotify_track" &&
            sourceType !== "spotify_album" &&
            sourceType !== "spotify_playlist"
        ) {
            return [];
        }

        const attempts: string[][] = [
            ["resolve", "--json", input],
            ["--json", input]
        ];

        let lastError: unknown = null;

        for (const args of attempts) {
            try {
                const stdout = await this.runBinary(this.spotiflacBinary, args);
                const payload = parseJsonFromMixedOutput(stdout);
                const rawEntries = extractEntries(payload);
                if (rawEntries.length === 0) {
                    continue;
                }

                const entries: ResolvedEntry[] = [];
                for (let i = 0; i < rawEntries.length; i++) {
                    const raw = rawEntries[i];
                    if (!raw || typeof raw !== "object") {
                        continue;
                    }

                    const rawObj = raw as Record<string, unknown>;
                    const canonical = readString(rawObj.canonical_id)
                        ?? readString(rawObj.spotify_uri)
                        ?? getCanonicalId(sourceType, input, rawObj);
                    const entryId = stableId("entry", canonical ?? `${input}:${i}`);

                    entries.push({
                        id: entryId,
                        title: readString(rawObj.title) ?? readString(rawObj.name),
                        artists: normalizeArtists(rawObj.artists)
                            ?? normalizeArtists(rawObj.artist)
                            ?? [],
                        durationMs: parseDurationMs(rawObj.duration_ms ?? rawObj.duration),
                        artworkUrl: readString(rawObj.artwork_url)
                            ?? readString(rawObj.thumbnail)
                            ?? readString(rawObj.cover_url),
                        originalInput: input,
                        canonicalId: canonical,
                        candidates: [
                            {
                                id: stableId("candidate", `${entryId}:spotiflac:stream`),
                                provider: "spotiflac",
                                kind: "stream",
                                quality: "lossless",
                                url: readString(rawObj.stream_url)
                                    ?? readString(rawObj.streamUrl)
                                    ?? readString(rawObj.url),
                                metadata: {
                                    providerRawId: readString(rawObj.id) ?? readString(rawObj.track_id)
                                }
                            },
                            {
                                id: stableId("candidate", `${entryId}:spotiflac:download`),
                                provider: "spotiflac",
                                kind: "download",
                                quality: "lossless",
                                url: readString(rawObj.download_url)
                                    ?? readString(rawObj.downloadUrl)
                                    ?? readString(rawObj.file_url),
                                metadata: {
                                    providerRawId: readString(rawObj.id) ?? readString(rawObj.track_id)
                                }
                            }
                        ]
                    });
                }

                if (entries.length > 0) {
                    return entries;
                }
            } catch (error) {
                lastError = error;
            }
        }

        if (lastError) {
            throw lastError;
        }

        return [];
    }

    private async runBinary(binary: string, args: string[]): Promise<string> {
        try {
            const result = await execFileAsync(binary, args, {
                timeout: this.timeoutMs,
                maxBuffer: 20 * 1024 * 1024,
                windowsHide: true,
                env: buildExecEnv()
            });
            return result.stdout;
        } catch (error) {
            throw normalizeProviderError(error, null);
        }
    }
}

function normalizeProviderError(error: unknown, requestId: string | null): LocalResolverError {
    if (error instanceof LocalResolverError) {
        return error;
    }

    if (isExecError(error)) {
        if (error.code === "ETIMEDOUT" || error.killed) {
            return new LocalResolverError("TIMEOUT", "Provider command timed out.", requestId);
        }

        if (error.code === "ENOENT") {
            return new LocalResolverError("PROVIDER_FAILED", `Executable not found: ${error.path ?? "unknown"}`, requestId);
        }

        const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
        const stdout = typeof error.stdout === "string" ? error.stdout.trim() : "";
        const message = stderr || stdout || error.message || "Provider command failed.";
        return new LocalResolverError("PROVIDER_FAILED", message, requestId);
    }

    if (error instanceof Error) {
        return new LocalResolverError("PROVIDER_FAILED", error.message, requestId);
    }

    return new LocalResolverError("INTERNAL_ERROR", "Unknown provider error.", requestId);
}

function isExecError(error: unknown): error is Error & {
    code?: string;
    killed?: boolean;
    path?: string;
    stdout?: string;
    stderr?: string;
} {
    return Boolean(error && typeof error === "object" && "message" in error);
}

function normalizeRequestId(value?: string): string | null {
    const requestId = value?.trim();
    return requestId ? requestId : null;
}

function resolveBinary(envVarName: string, localDir: string, baseName: string): string {
    const explicit = process.env[envVarName]?.trim();
    if (explicit) {
        return explicit;
    }

    const localBinaryPath = path.resolve(process.cwd(), localDir, getExeName(baseName));
    if (fs.existsSync(localBinaryPath)) {
        return localBinaryPath;
    }

    return getExeName(baseName);
}

function getExeName(baseName: string): string {
    return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function buildExecEnv(): NodeJS.ProcessEnv {
    const runtimeBinaryDirs = [
        path.resolve(process.cwd(), process.env.FFMPEG_INSTALL_DIR || ".ffmpeg"),
        path.resolve(process.cwd(), process.env.YTDLP_INSTALL_DIR || ".yt-dlp"),
        path.resolve(process.cwd(), process.env.SPOTIFLAC_INSTALL_DIR || ".spotiflac")
    ];

    const currentPath = process.env.PATH ?? process.env.Path ?? "";
    const runtimePath = currentPath
        ? `${runtimeBinaryDirs.join(path.delimiter)}${path.delimiter}${currentPath}`
        : runtimeBinaryDirs.join(path.delimiter);

    return {
        ...process.env,
        PATH: runtimePath,
        Path: runtimePath
    };
}

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

function detectSourceType(input: string): SourceType {
    const spotify = extractSpotify(input);
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

function extractSpotify(input: string): { kind: "track" | "album" | "playlist"; id: string } | null {
    const url = safeUrl(input);
    if (!url) return null;
    if (!url.hostname.toLowerCase().endsWith("spotify.com")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const kind = parts[0];
    const id = parts[1];
    if (!id) return null;
    if (kind === "track" || kind === "album" || kind === "playlist") {
        return { kind, id };
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

function getCanonicalId(sourceType: SourceType, input: string, raw?: Record<string, unknown>): string | null {
    const spotify = extractSpotify(input);
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

function normalizeEntry(entry: ResolvedEntry): ResolvedEntry {
    return {
        id: entry.id,
        title: entry.title ?? null,
        artists: entry.artists ?? [],
        durationMs: entry.durationMs ?? null,
        artworkUrl: entry.artworkUrl ?? null,
        originalInput: entry.originalInput,
        canonicalId: entry.canonicalId ?? null,
        candidates: (entry.candidates ?? []).map((candidate) => normalizeCandidate(candidate))
    };
}

function normalizeCandidate(candidate: ResolveCandidate): ResolveCandidate {
    return {
        id: candidate.id,
        provider: candidate.provider,
        kind: candidate.kind,
        quality: candidate.quality,
        url: candidate.url ?? null,
        metadata: candidate.metadata ?? {}
    };
}

export {
    LocalResolverService,
    LocalResolverError
};
