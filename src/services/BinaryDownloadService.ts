import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type DownloadProvider = "ytdlp" | "spotiflac";

type DownloadRequest = {
    provider: DownloadProvider;
    input: string;
    outputDir: string;
    fileName: string;
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
    private readonly spotiflacBinary: string;
    private readonly downloadTimeoutMs: number;

    constructor(options: {
        ytdlpBinary?: string;
        spotiflacBinary?: string;
        timeoutMs?: number;
        downloadTimeoutMs?: number;
    } = {}) {
        this.ytdlpBinary = options.ytdlpBinary ?? resolveBinary("YTDLP_BIN", ".yt-dlp", "yt-dlp");
        this.spotiflacBinary = options.spotiflacBinary ?? resolveBinary("SPOTIFLAC_BIN", ".spotiflac", "spotiflac");
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

        if (request.provider === "ytdlp") {
            const result = await this.runYtDlp(input, outputPath);
            return {
                filePath: result.filePath,
                provider: "ytdlp",
                stdout: result.stdout
            };
        }

        const result = await this.runSpotiFlac(input, outputPath);
        return {
            filePath: result.filePath,
            provider: "spotiflac",
            stdout: result.stdout
        };
    }

    private async runYtDlp(input: string, outputPath: string): Promise<{ stdout: string; filePath: string }> {
        const args = [
            "--no-warnings",
            "--no-playlist",
            "--no-progress",
            "--force-overwrites",
            "--format",
            "bestaudio/best",
            "--output",
            outputPath,
            input
        ];

        try {
            const result = await execFileAsync(this.ytdlpBinary, args, {
                timeout: this.downloadTimeoutMs,
                windowsHide: true,
                maxBuffer: 20 * 1024 * 1024,
                env: buildExecEnv()
            });
            const filePath = await this.resolveProducedFilePath(outputPath, "ytdlp");
            return {
                stdout: result.stdout,
                filePath
            };
        } catch (error) {
            throw new BinaryDownloadError("ytdlp", getExecErrorMessage(error));
        }
    }

    private async runSpotiFlac(input: string, outputPath: string): Promise<{ stdout: string; filePath: string }> {
        const outputDir = path.dirname(outputPath);
        await fs.promises.mkdir(outputDir, { recursive: true });
        const baseline = await listDirectoryMtimeMap(outputDir);
        const startedAt = Date.now();

        const attempts = [
            [input, outputDir]
        ];

        let lastError: unknown = null;

        for (const args of attempts) {
            try {
                const result = await execFileAsync(this.spotiflacBinary, args, {
                    timeout: this.downloadTimeoutMs,
                    windowsHide: true,
                    maxBuffer: 20 * 1024 * 1024,
                    env: buildExecEnv()
                });
                const filePath = await this.resolveSpotiFlacProducedFilePath(outputDir, baseline, startedAt)
                    .catch(() => null);
                if (!filePath) {
                    const failure = extractSpotiFlacFailure(result.stdout);
                    if (failure) {
                        throw new BinaryDownloadError("spotiflac", failure);
                    }
                    throw new BinaryDownloadError(
                        "spotiflac",
                        `SpotiFLAC exited without created audio file in ${outputDir}.`
                    );
                }
                return {
                    stdout: result.stdout,
                    filePath
                };
            } catch (error) {
                lastError = error;
            }
        }

        throw new BinaryDownloadError("spotiflac", getExecErrorMessage(lastError));
    }

    private async resolveSpotiFlacProducedFilePath(
        outputDir: string,
        baseline: Map<string, number>,
        startedAt: number
    ): Promise<string> {
        const files = await listDirectoryFiles(outputDir);
        const audioFiles = files.filter((file) => isAudioFile(file.fullPath));
        const addedAudio = audioFiles.filter((file) => !baseline.has(file.name));
        if (addedAudio.length > 0) {
            addedAudio.sort((left, right) => right.mtimeMs - left.mtimeMs);
            return addedAudio[0]!.fullPath;
        }

        const changedAudio = audioFiles.filter((file) => {
            const oldMtime = baseline.get(file.name);
            if (typeof oldMtime === "number") {
                return file.mtimeMs > oldMtime;
            }
            return file.mtimeMs >= startedAt;
        });
        if (changedAudio.length > 0) {
            changedAudio.sort((left, right) => right.mtimeMs - left.mtimeMs);
            return changedAudio[0]!.fullPath;
        }

        throw new BinaryDownloadError(
            "spotiflac",
            `Downloaded audio file was not found in output directory: ${outputDir}`
        );
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

async function pathExistsAsFile(filePath: string): Promise<boolean> {
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) {
        return false;
    }
    return stat.isFile();
}

async function listDirectoryFiles(dirPath: string): Promise<Array<{ name: string; fullPath: string; mtimeMs: number }>> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const files: Array<{ name: string; fullPath: string; mtimeMs: number }> = [];

    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const stat = await fs.promises.stat(fullPath).catch(() => null);
        if (!stat || !stat.isFile()) {
            continue;
        }

        files.push({
            name: entry.name,
            fullPath,
            mtimeMs: stat.mtimeMs
        });
    }

    return files;
}

async function listDirectoryMtimeMap(dirPath: string): Promise<Map<string, number>> {
    const files = await listDirectoryFiles(dirPath);
    const map = new Map<string, number>();
    for (const file of files) {
        map.set(file.name, file.mtimeMs);
    }
    return map;
}

function isAudioFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return [
        ".flac",
        ".mp3",
        ".m4a",
        ".aac",
        ".wav",
        ".ogg",
        ".opus",
        ".webm",
        ".mp4",
        ".mkv"
    ].includes(ext);
}

function extractSpotiFlacFailure(stdout: string): string | null {
    const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) {
        return null;
    }

    const hasFailedAllServices = lines.some((line) => line.includes("Failed all services"));
    const failedDownloadIndex = lines.findIndex((line) => line.startsWith("Failed downloads:"));
    if (!hasFailedAllServices && failedDownloadIndex < 0) {
        return null;
    }

    const errorLine = lines.find((line) => line.startsWith("Error: "));
    if (errorLine) {
        return `SpotiFLAC failed: ${errorLine.replace(/^Error:\s*/i, "").trim()}`;
    }

    const tail = lines.slice(Math.max(0, lines.length - 3)).join(" | ");
    return `SpotiFLAC failed all services. ${tail}`;
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
