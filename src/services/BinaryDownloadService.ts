import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

type DownloadProvider = "ytdlp" | "scdl";

type DownloadRequest = {
    provider: DownloadProvider;
    input: string;
    outputDir: string;
    fileName: string;
    metadata?: Record<string, unknown>;
};

type DownloadResult = {
    filePath: string;
    provider: DownloadProvider;
    stdout: string;
};

class BinaryDownloadError extends Error {
    public readonly provider: DownloadProvider;

    constructor(provider: DownloadProvider, message: string) {
        super(message);
        this.name = "BinaryDownloadError";
        this.provider = provider;
    }
}

class BinaryDownloadService {
    private readonly ytdlpBinary: string;
    private readonly scdlBinary: string;
    private readonly downloadTimeoutMs: number;

    constructor(options: {
        ytdlpBinary?: string;
        scdlBinary?: string;
        timeoutMs?: number;
        downloadTimeoutMs?: number;
    } = {}) {
        this.ytdlpBinary = options.ytdlpBinary ?? resolveBinary("YTDLP_BIN", ".yt-dlp", "yt-dlp");
        this.scdlBinary = options.scdlBinary ?? resolveBinary("SCDL_BIN", ".scdl", "scdl");
        this.downloadTimeoutMs = options.downloadTimeoutMs
            ?? options.timeoutMs
            ?? parseInt(process.env.DOWNLOAD_TIMEOUT_MS || "120000", 10);
    }

    public async downloadToFile(request: DownloadRequest): Promise<DownloadResult> {
        const input = request.input.trim();
        const outputDir = path.resolve(process.cwd(), request.outputDir);
        const fileName = sanitizeFileName(request.fileName);
        const outputPath = path.join(outputDir, fileName);

        if (!input) {
            throw new BinaryDownloadError(request.provider, "Input cannot be empty.");
        }

        await fs.promises.mkdir(outputDir, { recursive: true });

        const metadata = request.metadata ?? {};
        const preferScdl = isSoundCloudUrl(input) || isScSearchInput(input);
        let scdlError: unknown = null;

        if (preferScdl) {
            try {
                const scdlResult = await this.runScdl(input, outputPath);
                return {
                    filePath: scdlResult.filePath,
                    provider: "scdl",
                    stdout: scdlResult.stdout
                };
            } catch (error) {
                scdlError = error;
            }
        }

        try {
            const result = await this.runYtDlp(this.toYtDlpInput(input, metadata), outputPath, metadata);
            return {
                filePath: result.filePath,
                provider: "ytdlp",
                stdout: result.stdout
            };
        } catch (ytdlpError) {
            if (!scdlError) {
                throw ytdlpError;
            }

            const scdlMessage = getErrorMessage(scdlError);
            const ytdlpMessage = getErrorMessage(ytdlpError);
            throw new BinaryDownloadError(
                request.provider,
                `scdl failed: ${scdlMessage}\nyt-dlp failed: ${ytdlpMessage}`
            );
        }
    }

    private toYtDlpInput(input: string, metadata: Record<string, unknown>): string {
        if (!isScSearchInput(input)) {
            return input;
        }

        const scQuery = extractScSearchQuery(input);
        if (!scQuery) {
            const fallback = buildFallbackSearchQueries(extractExpectedHints(metadata))[0];
            return fallback ?? "ytsearch5:audio";
        }
        return `ytsearch5:${scQuery}`;
    }

    private async runYtDlp(
        input: string,
        outputPath: string,
        metadata: Record<string, unknown>
    ): Promise<{ stdout: string; filePath: string }> {
        const candidateInputs = await this.resolveYtDlpCandidates(input, metadata);
        const attempts = candidateInputs.length > 0
            ? candidateInputs
            : isYtSearchInput(input)
                ? []
                : [input];

        if (attempts.length === 0) {
            throw new BinaryDownloadError("ytdlp", "No suitable YouTube candidates found for this query.");
        }
        let lastError: unknown = null;

        for (const sourceInput of attempts) {
            const args = [
                "--no-warnings",
                "--no-playlist",
                "--no-progress",
                "--no-part",
                "--force-overwrites",
                "--format",
                "bestaudio/best",
                "--extract-audio",
                "--audio-format",
                "mp3",
                "--audio-quality",
                "0",
                "--print",
                "after_move:filepath",
                "--output",
                outputPath,
                sourceInput
            ];

            try {
                const result = await execFileAsync(this.ytdlpBinary, args, {
                    timeout: this.downloadTimeoutMs,
                    windowsHide: true,
                    maxBuffer: 20 * 1024 * 1024,
                    env: buildExecEnv()
                });

                const printedPath = await this.resolvePrintedOutputPath(result.stdout);
                if (printedPath) {
                    return {
                        stdout: result.stdout,
                        filePath: printedPath
                    };
                }

                const filePath = await this.resolveProducedFilePath(outputPath, "ytdlp");
                return {
                    stdout: result.stdout,
                    filePath
                };
            } catch (error) {
                lastError = error;
            }
        }

        throw new BinaryDownloadError("ytdlp", getExecErrorMessage(lastError));
    }

    private async runScdl(input: string, outputPath: string): Promise<{ stdout: string; filePath: string }> {
        const outputDir = path.dirname(outputPath);
        const runDir = path.join(outputDir, `.scdl-run-${randomUUID()}`);
        await fs.promises.mkdir(runDir, { recursive: true });

        const searchQuery = extractScSearchQuery(input);
        const args = searchQuery
            ? [
                "-s",
                searchQuery,
                "--path",
                runDir,
                "--hide-progress",
                "--overwrite",
                "--onlymp3",
                "--no-playlist",
                "--error"
            ]
            : [
                "-l",
                input,
                "--path",
                runDir,
                "--hide-progress",
                "--overwrite",
                "--onlymp3",
                "--no-playlist",
                "--error"
            ];

        try {
            const result = await execFileAsync(this.scdlBinary, args, {
                timeout: this.downloadTimeoutMs,
                windowsHide: true,
                maxBuffer: 20 * 1024 * 1024,
                env: buildExecEnv()
            });

            const producedFile = await this.resolveScdlOutputFile(runDir);
            await moveFile(producedFile, outputPath);
            await fs.promises.rm(runDir, { recursive: true, force: true });

            const stdout = mergeOutput(result.stdout, result.stderr);
            return {
                stdout,
                filePath: outputPath
            };
        } catch (error) {
            await fs.promises.rm(runDir, { recursive: true, force: true }).catch(() => undefined);
            throw new BinaryDownloadError("scdl", getExecErrorMessage(error));
        }
    }

    private async resolveScdlOutputFile(runDir: string): Promise<string> {
        const entries = await fs.promises.readdir(runDir, { withFileTypes: true });
        const fileCandidates = entries
            .filter((entry) => entry.isFile())
            .map((entry) => path.join(runDir, entry.name));

        if (fileCandidates.length === 0) {
            throw new BinaryDownloadError("scdl", `Downloaded file was not found in scdl output directory: ${runDir}`);
        }

        const preferred = fileCandidates.filter((filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            return ext === ".mp3" || ext === ".m4a" || ext === ".flac" || ext === ".opus";
        });
        const picked = preferred.length > 0 ? preferred : fileCandidates;

        const withStats: Array<{ filePath: string; mtimeMs: number }> = [];
        for (const filePath of picked) {
            const stat = await fs.promises.stat(filePath).catch(() => null);
            if (!stat || !stat.isFile()) {
                continue;
            }
            withStats.push({
                filePath,
                mtimeMs: stat.mtimeMs
            });
        }

        if (withStats.length === 0) {
            throw new BinaryDownloadError("scdl", `Downloaded file candidates are invalid in directory: ${runDir}`);
        }

        withStats.sort((left, right) => right.mtimeMs - left.mtimeMs);
        return withStats[0]!.filePath;
    }

    private async resolveYtDlpCandidates(input: string, metadata: Record<string, unknown>): Promise<string[]> {
        if (!isYtSearchInput(input)) {
            return [input];
        }

        const expected = extractExpectedHints(metadata);
    const primaryQuery = widenSearchQuery(input, 10);
        const candidates: string[] = [];

        const primary = await this.collectSearchCandidateUrls(primaryQuery, expected);
        candidates.push(...primary);

        if (candidates.length === 0) {
            const fallbackQueries = buildFallbackSearchQueries(expected);
            for (const query of fallbackQueries) {
                const fallbackUrls = await this.collectSearchCandidateUrls(query, expected);
                candidates.push(...fallbackUrls);
                if (candidates.length > 0) {
                    break;
                }
            }
        }

        return unique(candidates);
    }

    private async collectSearchCandidateUrls(query: string, expected: ExpectedTrackHints): Promise<string[]> {
        const args = [
            "--dump-single-json",
            "--no-warnings",
            query
        ];

        try {
            const result = await execFileAsync(this.ytdlpBinary, args, {
                timeout: Math.min(this.downloadTimeoutMs, 30_000),
                windowsHide: true,
                maxBuffer: 20 * 1024 * 1024,
                env: buildExecEnv()
            });
            const payload = parseJsonFromMixedOutput(result.stdout);
            const entries = extractEntries(payload);
            if (entries.length === 0) {
                return [];
            }

            const scored = entries
                .map((entry) => scoreSearchEntry(entry, expected))
                .filter((item): item is ScoredSearchEntry => item !== null)
                .sort((left, right) => right.score - left.score);
            return scored.map((item) => item.url);
        } catch {
            return [];
        }
    }

    private async resolvePrintedOutputPath(stdout: string): Promise<string | null> {
        const lines = stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        for (let i = lines.length - 1; i >= 0; i--) {
            const candidate = lines[i];
            if (!candidate || candidate.includes("[download]")) {
                continue;
            }

            const stat = await fs.promises.stat(candidate).catch(() => null);
            if (stat && stat.isFile()) {
                return candidate;
            }
        }

        return null;
    }

    private async resolveProducedFilePath(outputPath: string, provider: DownloadProvider): Promise<string> {
        const direct = await pathExistsAsFile(outputPath);
        if (direct) {
            return outputPath;
        }

        const dir = path.dirname(outputPath);
        const baseName = path.basename(outputPath);
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        const candidates = entries
            .filter((entry) => entry.isFile() && entry.name.startsWith(`${baseName}.`))
            .map((entry) => path.join(dir, entry.name));

        if (candidates.length === 0) {
            throw new BinaryDownloadError(
                provider,
                `Downloaded file was not found for requested output path: ${outputPath}`
            );
        }

        const withStats: Array<{ filePath: string; mtimeMs: number }> = [];
        for (const filePath of candidates) {
            const stat = await fs.promises.stat(filePath).catch(() => null);
            if (!stat || !stat.isFile()) {
                continue;
            }
            withStats.push({
                filePath,
                mtimeMs: stat.mtimeMs
            });
        }

        if (withStats.length === 0) {
            throw new BinaryDownloadError(
                provider,
                `Downloaded file candidates are missing or invalid for output path: ${outputPath}`
            );
        }

        withStats.sort((left, right) => right.mtimeMs - left.mtimeMs);
        return withStats[0]!.filePath;
    }
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
        path.resolve(process.cwd(), process.env.SCDL_INSTALL_DIR || ".scdl")
    ];

    const currentPath = process.env.PATH ?? process.env.Path ?? "";
    const runtimePath = currentPath
        ? `${runtimeBinaryDirs.join(path.delimiter)}${path.delimiter}${currentPath}`
        : runtimeBinaryDirs.join(path.delimiter);

    return {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
        LANG: process.env.LANG ?? "C.UTF-8",
        PATH: runtimePath,
        Path: runtimePath
    };
}

function sanitizeFileName(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error("fileName cannot be empty.");
    }

    const hasTraversal = trimmed.includes("..") || path.isAbsolute(trimmed);
    if (hasTraversal) {
        throw new Error("fileName must be a plain file name without path traversal.");
    }

    return trimmed.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
}

function getExecErrorMessage(error: unknown): string {
    if (!error || typeof error !== "object") {
        return "Unknown process error.";
    }

    const err = error as {
        message?: string;
        code?: string;
        path?: string;
        stdout?: string;
        stderr?: string;
    };

    if (err.code === "ENOENT") {
        return `Executable not found: ${err.path ?? "unknown"}`;
    }

    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    const stdout = typeof err.stdout === "string" ? err.stdout.trim() : "";
    if (stderr) return stderr;
    if (stdout) return stdout;
    return err.message ?? "Unknown process error.";
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    return getExecErrorMessage(error);
}

async function pathExistsAsFile(filePath: string): Promise<boolean> {
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) {
        return false;
    }
    return stat.isFile();
}

type ExpectedTrackHints = {
    title: string | null;
    artists: string[];
    durationMs: number | null;
};

type ScoredSearchEntry = {
    url: string;
    score: number;
};

function extractExpectedHints(metadata: Record<string, unknown>): ExpectedTrackHints {
    const title = readString(metadata.expectedTitle);
    const artists = readStringArray(metadata.expectedArtists);
    const durationMs = readPositiveNumber(metadata.expectedDurationMs);
    return {
        title,
        artists,
        durationMs
    };
}

function isYtSearchInput(input: string): boolean {
    const trimmed = input.trim().toLowerCase();
    return trimmed.startsWith("ytsearch");
}

function isScSearchInput(input: string): boolean {
    const trimmed = input.trim().toLowerCase();
    return trimmed.startsWith("scsearch");
}

function extractScSearchQuery(input: string): string | null {
    const trimmed = input.trim();
    const match = trimmed.match(/^scsearch\d*:(.+)$/i);
    if (!match?.[1]) {
        return null;
    }
    const query = match[1].trim();
    return query || null;
}

function isSoundCloudUrl(input: string): boolean {
    try {
        const url = new URL(input.trim());
        const host = url.hostname.toLowerCase();
        return host === "soundcloud.com" || host.endsWith(".soundcloud.com") || host === "snd.sc";
    } catch {
        return false;
    }
}

function widenSearchQuery(input: string, minCount: number): string {
    const trimmed = input.trim();
    const match = trimmed.match(/^ytsearch(\d+):/i);
    if (!match?.[1]) {
        return trimmed;
    }

    const currentCount = Number(match[1]);
    if (!Number.isFinite(currentCount)) {
        return trimmed;
    }

    const nextCount = Math.max(Math.floor(currentCount), minCount);
    return trimmed.replace(/^ytsearch\d+:/i, `ytsearch${nextCount}:`);
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

    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line) {
            continue;
        }
        if (!line.startsWith("{") && !line.startsWith("[")) {
            continue;
        }

        try {
            return JSON.parse(line);
        } catch {
            // continue
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
    if (Array.isArray(obj.entries)) {
        return obj.entries;
    }
    return [obj];
}

function scoreSearchEntry(rawEntry: unknown, expected: ExpectedTrackHints): ScoredSearchEntry | null {
    if (!rawEntry || typeof rawEntry !== "object") {
        return null;
    }

    const entry = rawEntry as Record<string, unknown>;
    const title = readString(entry.title) ?? "";
    const uploader = readString(entry.uploader)
        ?? readString(entry.channel)
        ?? "";
    const durationSec = readPositiveNumber(entry.duration);
    const url = resolveEntryUrl(entry);
    if (!url) {
        return null;
    }

    const availability = readString(entry.availability) ?? "";
    const unavailable = availability.toLowerCase().includes("unavailable")
        || availability.toLowerCase().includes("private")
        || Boolean(entry.is_unavailable);
    if (unavailable) {
        return null;
    }

    if (typeof durationSec === "number") {
        const expectedDurationSec = expected.durationMs !== null ? expected.durationMs / 1000 : null;
        if (expectedDurationSec === null && (durationSec < 60 || durationSec > 20 * 60)) {
            return null;
        }
        if (
            expectedDurationSec !== null
            && expectedDurationSec <= 12 * 60
            && durationSec > Math.max(expectedDurationSec * 4, 20 * 60)
        ) {
            return null;
        }
    }

    const titleSimilarity = expected.title ? similarityTokenScore(expected.title, title) : 0;
    if (expected.title && titleSimilarity < 0.45) {
        return null;
    }

    let score = 0;
    if (expected.title) {
        score += titleSimilarity * 120;
    }

    if (expected.artists.length > 0) {
        const haystack = `${title} ${uploader}`;
        const normalizedHaystack = normalizeForCompare(haystack);
        for (const artist of expected.artists) {
            const normalizedArtist = normalizeForCompare(artist);
            if (normalizedArtist.length > 0 && normalizedHaystack.includes(normalizedArtist)) {
                score += 100;
                continue;
            }

            const tokenScore = similarityTokenScore(artist, haystack, true);
            score += tokenScore * 25;
        }
    }

    if (typeof durationSec === "number") {
        score += durationScore(durationSec, expected.durationMs);
    } else {
        score -= 5;
    }

    const badContentPenalty = qualityKeywordPenalty(`${title} ${uploader}`);
    score += badContentPenalty;
    if (badContentPenalty <= -40 && expected.artists.length > 0) {
        return null;
    }

    return {
        url,
        score
    };
}

function resolveEntryUrl(entry: Record<string, unknown>): string | null {
    const webpage = readString(entry.webpage_url);
    if (webpage) {
        return webpage;
    }

    const direct = readString(entry.url);
    if (direct && /^https?:\/\//i.test(direct)) {
        return direct;
    }

    const id = readString(entry.id);
    if (id) {
        return `https://www.youtube.com/watch?v=${id}`;
    }

    return null;
}

function durationScore(durationSec: number, expectedDurationMs: number | null): number {
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
        return -20;
    }

    if (expectedDurationMs !== null && expectedDurationMs > 0) {
        const expectedSec = expectedDurationMs / 1000;
        const diff = Math.abs(durationSec - expectedSec);
        if (diff <= 5) return 50;
        if (diff <= 15) return 40;
        if (diff <= 30) return 30;
        if (diff <= 60) return 20;
        if (diff <= 120) return 10;
        if (diff <= 240) return 0;
        return -40;
    }

    if (durationSec >= 45 && durationSec <= 12 * 60) {
        return 15;
    }
    if (durationSec > 30 * 60) {
        return -50;
    }
    return -5;
}

function qualityKeywordPenalty(text: string): number {
    const lower = text.toLowerCase();
    const badKeywords = [
        "rain",
        "ambience",
        "ambient",
        "noise",
        "study",
        "sleep",
        "24/7",
        "live",
        "hours",
        "relax",
        "kids",
        "kid",
        "nursery",
        "lullaby",
        "baby",
        "bedtime",
        "womb",
        "peekaboo",
        "cocomelon",
        "super simple",
        "white noise"
    ];

    let penalty = 0;
    for (const keyword of badKeywords) {
        if (lower.includes(keyword)) {
            penalty -= 15;
        }
    }
    return penalty;
}

function similarityTokenScore(expectedRaw: string, targetRaw: string, strictArtistMode: boolean = false): number {
    const expected = tokenize(expectedRaw, strictArtistMode);
    const target = tokenize(targetRaw, false);
    if (expected.length === 0 || target.length === 0) {
        return 0;
    }

    const targetSet = new Set(target);
    let hits = 0;
    for (const token of expected) {
        if (targetSet.has(token)) {
            hits += 1;
        }
    }
    return hits / expected.length;
}

function tokenize(value: string, strictArtistMode: boolean): string[] {
    const stopWords = strictArtistMode
        ? new Set(["the", "and", "feat", "ft", "to", "official", "music", "topic", "audio", "sleep"])
        : new Set<string>();

    return value
        .toLowerCase()
        .replace(/[^a-z0-9а-яіїєґё]+/gi, " ")
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2 && !stopWords.has(part));
}

function readString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => readString(item))
        .filter((item): item is string => item !== null);
}

function readPositiveNumber(value: unknown): number | null {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }
    return numeric;
}

function unique(values: string[]): string[] {
    const set = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        if (set.has(value)) {
            continue;
        }
        set.add(value);
        result.push(value);
    }
    return result;
}

function mergeOutput(stdout: string | Buffer, stderr: string | Buffer): string {
    const out = typeof stdout === "string" ? stdout.trim() : stdout.toString("utf-8").trim();
    const err = typeof stderr === "string" ? stderr.trim() : stderr.toString("utf-8").trim();
    if (out && err) {
        return `${out}\n${err}`;
    }
    return out || err || "";
}

async function moveFile(fromPath: string, toPath: string): Promise<void> {
    if (fromPath === toPath) {
        return;
    }
    try {
        await fs.promises.rename(fromPath, toPath);
        return;
    } catch (error) {
        if (!isErrnoWithCode(error, "EXDEV")) {
            throw error;
        }
    }

    await fs.promises.copyFile(fromPath, toPath);
    await fs.promises.unlink(fromPath);
}

function isErrnoWithCode(error: unknown, code: string): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }
    const value = error as { code?: unknown };
    return typeof value.code === "string" && value.code === code;
}

function buildFallbackSearchQueries(expected: ExpectedTrackHints): string[] {
    const title = expected.title?.trim() ?? "";
    const artist = expected.artists[0]?.trim() ?? "";
    if (!title && !artist) {
        return [];
    }

    const joined = [title, artist].filter((value) => Boolean(value)).join(" ").trim();

    const candidates = [
        `${joined} audio`.trim(),
        `${joined} official audio`.trim(),
        `${joined} lyrics`.trim(),
        joined
    ].filter((value) => value.length > 0);

    return unique(candidates.map((value) => `ytsearch5:${value}`));
}

function normalizeForCompare(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9а-яіїєґё]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export type {
    DownloadProvider,
    DownloadRequest,
    DownloadResult
};

export {
    BinaryDownloadService,
    BinaryDownloadError
};
