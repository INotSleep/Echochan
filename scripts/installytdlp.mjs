import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const DOWNLOAD_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

function getExeName(baseName) {
    return process.platform === 'win32' ? `${baseName}.exe` : baseName;
}

function detectTarget() {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'win32') {
        if (arch === 'x64') return 'windows-x64';
        if (arch === 'arm64') return 'windows-arm64';
        if (arch === 'ia32') return 'windows-x86';
        throw new Error(`Unsupported Windows architecture: ${arch}`);
    }

    if (platform === 'linux') {
        if (arch === 'x64') return 'linux-x64';
        if (arch === 'arm64') return 'linux-arm64';
        throw new Error(`Unsupported Linux architecture: ${arch}`);
    }

    if (platform === 'darwin') {
        if (arch === 'x64' || arch === 'arm64') return 'macos';
        throw new Error(`Unsupported macOS architecture: ${arch}`);
    }

    throw new Error(`Unsupported platform: ${platform}`);
}

function resolveAssetName(target) {
    if (target === 'windows-x64') return 'yt-dlp.exe';
    if (target === 'windows-arm64') return 'yt-dlp_arm64.exe';
    if (target === 'windows-x86') return 'yt-dlp_x86.exe';
    if (target === 'linux-x64') return 'yt-dlp_linux';
    if (target === 'linux-arm64') return 'yt-dlp_linux_aarch64';
    if (target === 'macos') return 'yt-dlp_macos';
    throw new Error(`Unsupported target: ${target}`);
}

async function readJson(filePath) {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function readPackageConfig() {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = await readJson(packageJsonPath);
    return packageJson.ytdlp ?? {};
}

function resolveInstallDir(config) {
    const rawDir = process.env.YTDLP_INSTALL_DIR || config.installDir || '.yt-dlp';
    return path.resolve(process.cwd(), rawDir);
}

function isExecutable(filePath) {
    try {
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) return false;
        if (process.platform === 'win32') return true;
        return (stats.mode & 0o111) !== 0;
    } catch {
        return false;
    }
}

function getInstalledPath(dir) {
    const executablePath = path.join(dir, getExeName('yt-dlp'));
    return isExecutable(executablePath) ? executablePath : null;
}

async function mkdirp(dirPath) {
    await fs.promises.mkdir(dirPath, { recursive: true });
}

async function removeSafe(dirPath) {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
}

async function fetchText(url) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return await response.text();
}

async function downloadFile(url, destinationPath, label) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }

    await mkdirp(path.dirname(destinationPath));

    const totalBytes = Number(response.headers.get('content-length') || 0);
    let receivedBytes = 0;
    const readable = Readable.fromWeb(response.body);

    readable.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (!process.stdout.isTTY) return;
        if (totalBytes > 0) {
            const percent = ((receivedBytes / totalBytes) * 100).toFixed(1);
            process.stdout.write(`\r${label}: ${percent}%`);
        } else {
            process.stdout.write(`\r${label}: ${Math.round(receivedBytes / 1048576)} MiB`);
        }
    });

    try {
        await pipeline(readable, fs.createWriteStream(destinationPath));
    } finally {
        if (process.stdout.isTTY) {
            process.stdout.write('\n');
        }
    }
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    for await (const chunk of stream) {
        hash.update(chunk);
    }

    return hash.digest('hex').toLowerCase();
}

function parseChecksumFile(content) {
    const result = new Map();
    for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^([A-Fa-f0-9]{64})\s+\*?(.+?)\s*$/);
        if (match) {
            result.set(match[2], match[1].toLowerCase());
        }
    }
    return result;
}

async function writeExecutable(filePath) {
    if (process.platform !== 'win32') {
        await fs.promises.chmod(filePath, 0o755);
    }
}

export async function ensureYtDlp(options = {}) {
    const packageConfig = await readPackageConfig();
    const config = {
        ...packageConfig,
        ...options
    };

    const finalDir = resolveInstallDir(config);
    const stagingDir = `${finalDir}.staging`;

    if (!config.force) {
        const cached = getInstalledPath(finalDir);
        if (cached) {
            return { binaryPath: cached };
        }
    }

    const target = detectTarget();
    const assetName = resolveAssetName(target);
    const sourceUrl = `${DOWNLOAD_BASE}/${assetName}`;
    const checksumUrl = `${DOWNLOAD_BASE}/SHA2-256SUMS`;
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'installytdlp-'));

    try {
        await removeSafe(stagingDir);
        await mkdirp(stagingDir);

        const downloadedPath = path.join(tempRoot, assetName);
        await downloadFile(sourceUrl, downloadedPath, assetName);

        const checksums = parseChecksumFile(await fetchText(checksumUrl));
        const expectedHash = checksums.get(assetName);
        if (expectedHash) {
            const actualHash = await sha256File(downloadedPath);
            if (actualHash !== expectedHash) {
                throw new Error(`Checksum mismatch for ${assetName}: expected ${expectedHash}, got ${actualHash}`);
            }
        } else {
            console.warn(`Checksum entry not found for ${assetName}, skipping verification.`);
        }

        const binaryPath = path.join(stagingDir, getExeName('yt-dlp'));
        await fs.promises.copyFile(downloadedPath, binaryPath);
        await writeExecutable(binaryPath);

        await fs.promises.writeFile(path.join(stagingDir, 'installytdlp.json'), JSON.stringify({
            target,
            assetName,
            sourceUrl,
            checksumUrl,
            installedAt: new Date().toISOString()
        }, null, 4));

        await removeSafe(finalDir);
        await fs.promises.rename(stagingDir, finalDir);

        return { binaryPath: path.join(finalDir, getExeName('yt-dlp')) };
    } catch (error) {
        await removeSafe(stagingDir);
        throw error;
    } finally {
        await removeSafe(tempRoot);
    }
}

async function main() {
    const result = await ensureYtDlp({
        force: process.argv.includes('--force')
    });

    console.log(`yt-dlp: ${result.binaryPath}`);
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryFilePath && currentFilePath === entryFilePath) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : error);
        process.exit(1);
    });
}
