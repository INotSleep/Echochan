import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ResolveCandidate, ResolveError, ResolveInput, ResolveResult, ResolvedEntry, SourceType } from "../resolver/contracts.js";
import type { ResolverClient } from "../resolver/client/ResolverClient.js";
import { SpotifyResolverMicroModule } from "../resolver/micromodules/SpotifyResolverMicroModule.js";
import type { ResolveModuleContext, ResolverMicroModule } from "../resolver/micromodules/contracts.js";
import {
    detectSourceType,
    extractEntries,
    normalizeArtists,
    parseDurationMs,
    parseJsonFromMixedOutput,
    readString
} from "../resolver/micromodules/shared.js";
import { YtDlpResolverMicroModule } from "../resolver/micromodules/YtDlpResolverMicroModule.js";

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

type LocalResolverOptions = {
    timeoutMs?: number;
    ytdlpBinary?: string;
    microModules?: ResolverMicroModule[];
};

type TrackSuggestion = {
    name: string;
    value: string;
};

class LocalResolverService implements ResolverClient {
    private readonly timeoutMs: number;
    private readonly ytdlpBinary: string;
    private readonly microModules: ResolverMicroModule[];

    constructor(options: LocalResolverOptions = {}) {
        this.timeoutMs = options.timeoutMs ?? parseInt(process.env.PROVIDER_TIMEOUT_MS || "15000", 10);
        this.ytdlpBinary = options.ytdlpBinary ?? resolveBinary("YTDLP_BIN", ".yt-dlp", "yt-dlp");
        this.microModules = options.microModules ?? this.createDefaultMicroModules();
    }

    public async resolve(input: ResolveInput): Promise<ResolveResult> {
        const requestId = normalizeRequestId(input.requestId);
        const normalizedInput = input.input?.trim();

        if (!normalizedInput) {
            throw new LocalResolverError("INVALID_INPUT", "Field 'input' must be a non-empty string.", requestId);
        }

        const sourceType = detectSourceType(normalizedInput);
        const context: ResolveModuleContext = {
            input: normalizedInput,
            sourceType,
            requestId,
            requestedBy: input.requestedBy?.trim() ?? null
        };

        const pipeline = this.resolvePipeline(sourceType);
        let firstError: unknown = null;

        for (const module of pipeline) {
            try {
                const entries = await module.resolveByInput(context);
                if (entries.length > 0) {
                    return {
                        requestId,
                        sourceType,
                        entries: entries.map((entry) => normalizeEntry(entry))
                    };
                }
            } catch (error) {
                if (!firstError) {
                    firstError = error;
                }
            }
        }

        if (firstError) {
            throw normalizeProviderError(firstError, requestId);
        }

        throw new LocalResolverError("NOT_FOUND", "No tracks were resolved for this input.", requestId);
    }

    public async suggestTracks(query: string, limit: number = 10): Promise<TrackSuggestion[]> {
        const normalized = query.trim();
        if (normalized.length < 2) {
            return [];
        }

        const maxItems = Math.max(1, Math.min(25, Math.floor(limit)));
        const searchInput = `ytsearch${maxItems}:${normalized}`;
        const args = [
            "--dump-single-json",
            "--no-warnings",
            "--flat-playlist",
            searchInput
        ];

        try {
            const result = await execFileAsync(this.ytdlpBinary, args, {
                timeout: Math.min(this.timeoutMs, 2_800),
                maxBuffer: 20 * 1024 * 1024,
                windowsHide: true,
                env: buildExecEnv()
            });
            const payload = parseJsonFromMixedOutput(result.stdout);
            const entries = extractEntries(payload);
            const suggestions: TrackSuggestion[] = [];
            const seenValues = new Set<string>();

            for (const rawEntry of entries) {
                if (suggestions.length >= maxItems) {
                    break;
                }

                if (!rawEntry || typeof rawEntry !== "object") {
                    continue;
                }

                const entry = rawEntry as Record<string, unknown>;
                const title = readString(entry.title) ?? readString(entry.fulltitle);
                if (!title) {
                    continue;
                }

                const artist = normalizeArtists(entry.artists)?.[0]
                    ?? readString(entry.artist)
                    ?? readString(entry.channel)
                    ?? readString(entry.uploader)
                    ?? null;
                const durationMs = parseDurationMs(entry.duration);
                const duration = durationMs ? formatDuration(durationMs) : null;
                const label = buildSuggestionLabel(title, artist, duration);
                const value = buildSuggestionValue(entry, title, artist);

                if (!value || seenValues.has(value)) {
                    continue;
                }

                seenValues.add(value);
                suggestions.push({
                    name: trimForDiscord(label),
                    value: trimForDiscord(value)
                });
            }

            return suggestions;
        } catch {
            return [];
        }
    }

    private createDefaultMicroModules(): ResolverMicroModule[] {
        return [
            new SpotifyResolverMicroModule({
                timeoutMs: this.timeoutMs
            }),
            new YtDlpResolverMicroModule({
                binaryPath: this.ytdlpBinary,
                runBinary: (binary, args) => this.runBinary(binary, args)
            })
        ];
    }

    private resolvePipeline(sourceType: SourceType): ResolverMicroModule[] {
        const spotifySource = sourceType === "spotify_track" || sourceType === "spotify_album" || sourceType === "spotify_playlist";
        const modules = this.microModules.filter((module) => module.canResolve(sourceType));

        if (!spotifySource) {
            return modules.sort((left, right) => (left.id === "ytdlp" ? -1 : right.id === "ytdlp" ? 1 : 0));
        }

        return modules.sort((left, right) => (left.id === "spotify" ? -1 : right.id === "spotify" ? 1 : 0));
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
        path.resolve(process.cwd(), process.env.YTDLP_INSTALL_DIR || ".yt-dlp")
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

export type {
    TrackSuggestion
};

function buildSuggestionLabel(title: string, artist: string | null, duration: string | null): string {
    const parts = [title.trim()];
    if (artist) {
        parts.push(artist.trim());
    }
    if (duration) {
        parts.push(duration);
    }
    return parts.join(" | ");
}

function buildSuggestionValue(entry: Record<string, unknown>, title: string, artist: string | null): string {
    const webpage = readString(entry.webpage_url);
    if (webpage) {
        return webpage;
    }

    const rawUrl = readString(entry.url);
    if (rawUrl?.startsWith("http://") || rawUrl?.startsWith("https://")) {
        return rawUrl;
    }

    const id = readString(entry.id);
    if (id) {
        return `https://www.youtube.com/watch?v=${id}`;
    }

    const fallback = [title, artist].filter((value): value is string => Boolean(value)).join(" ").trim();
    if (!fallback) {
        return "";
    }
    return `ytsearch1:${fallback}`;
}

function trimForDiscord(value: string): string {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length <= 100) {
        return normalized;
    }
    return normalized.slice(0, 100);
}

function formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
