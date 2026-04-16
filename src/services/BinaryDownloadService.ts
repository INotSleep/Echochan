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
    private readonly timeoutMs: number;

    constructor(options: {
        ytdlpBinary?: string;
        spotiflacBinary?: string;
        timeoutMs?: number;
    } = {}) {
        this.ytdlpBinary = options.ytdlpBinary ?? resolveBinary("YTDLP_BIN", ".yt-dlp", "yt-dlp");
        this.spotiflacBinary = options.spotiflacBinary ?? resolveBinary("SPOTIFLAC_BIN", ".spotiflac", "spotiflac");
        this.timeoutMs = options.timeoutMs ?? parseInt(process.env.PROVIDER_TIMEOUT_MS || "15000", 10);
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
            "--output",
            outputPath,
            input
        ];

        try {
            const result = await execFileAsync(this.ytdlpBinary, args, {
                timeout: this.timeoutMs,
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
        const attempts = [
            ["download", "--output", outputPath, input],
            ["--output", outputPath, input]
        ];

        let lastError: unknown = null;

        for (const args of attempts) {
            try {
                const result = await execFileAsync(this.spotiflacBinary, args, {
                    timeout: this.timeoutMs,
                    windowsHide: true,
                    maxBuffer: 20 * 1024 * 1024,
                    env: buildExecEnv()
                });
                const filePath = await this.resolveProducedFilePath(outputPath, "spotiflac");
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

export type {
    DownloadProvider,
    DownloadRequest,
    DownloadResult
};

export {
    BinaryDownloadService,
    BinaryDownloadError
};
