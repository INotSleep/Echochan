import type { ResolveCandidate, ResolvedEntry, SourceType } from "../contracts.js";
import type { ResolveModuleContext, ResolverMicroModule } from "./contracts.js";
import {
    extractEntries,
    getCanonicalId,
    normalizeArtists,
    parseDurationMs,
    parseJsonFromMixedOutput,
    readString,
    stableId
} from "./shared.js";

type YtDlpResolverMicroModuleOptions = {
    binaryPath: string;
    runBinary: (binary: string, args: string[]) => Promise<string>;
};

class YtDlpResolverMicroModule implements ResolverMicroModule {
    public readonly id = "ytdlp" as const;
    private readonly binaryPath: string;
    private readonly runBinary: (binary: string, args: string[]) => Promise<string>;

    constructor(options: YtDlpResolverMicroModuleOptions) {
        this.binaryPath = options.binaryPath;
        this.runBinary = options.runBinary;
    }

    public canResolve(sourceType: SourceType): boolean {
        return sourceType !== "spotify_track" && sourceType !== "spotify_album" && sourceType !== "spotify_playlist";
    }

    public async resolveByInput(context: ResolveModuleContext): Promise<ResolvedEntry[]> {
        const args = ["--dump-single-json", "--no-warnings"];
        if (context.sourceType === "youtube") {
            args.push("--no-playlist");
        }
        args.push(context.input);

        const stdout = await this.runBinary(this.binaryPath, args);
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
            const canonical = getCanonicalId(context.sourceType, context.input, rawObj);
            const entryId = stableId("entry", canonical ?? `${context.input}:${i}`);
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
                originalInput: context.input,
                canonicalId: canonical,
                candidates: [
                    this.buildStreamCandidate(entryId, context, rawObj, streamUrl),
                    this.buildDownloadCandidate(entryId, rawObj, streamUrl)
                ]
            });
        }

        return entries;
    }

    public async search(query: string): Promise<string> {
        const normalized = query.trim();
        if (!normalized) {
            return "ytsearch1:music";
        }
        return `ytsearch1:${normalized}`;
    }

    public async downloadByLink(input: string): Promise<string> {
        return input;
    }

    private buildStreamCandidate(
        entryId: string,
        context: ResolveModuleContext,
        rawObj: Record<string, unknown>,
        streamUrl: string | null
    ): ResolveCandidate {
        return {
            id: stableId("candidate", `${entryId}:ytdlp:stream`),
            provider: "ytdlp",
            kind: "stream",
            quality: context.sourceType === "direct_url" ? "unknown" : "lossy",
            url: streamUrl,
            metadata: {
                extractor: rawObj.extractor ?? null,
                webpageUrl: rawObj.webpage_url ?? null
            }
        };
    }

    private buildDownloadCandidate(
        entryId: string,
        rawObj: Record<string, unknown>,
        streamUrl: string | null
    ): ResolveCandidate {
        return {
            id: stableId("candidate", `${entryId}:ytdlp:download`),
            provider: "ytdlp",
            kind: "download",
            quality: "lossy",
            url: streamUrl,
            metadata: {
                extractor: rawObj.extractor ?? null
            }
        };
    }
}

export type {
    YtDlpResolverMicroModuleOptions
};

export {
    YtDlpResolverMicroModule
};
