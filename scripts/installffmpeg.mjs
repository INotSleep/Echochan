import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const BTBN_DOWNLOAD_BASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download';
const EVERMEET_ZIP_FFMPEG = 'https://evermeet.cx/ffmpeg/getrelease/zip';
const EVERMEET_ZIP_FFPROBE = 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip';

function getExeName(baseName) {
    return process.platform === 'win32' ? `${baseName}.exe` : baseName;
}

function detectTarget() {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'win32') {
        if (arch === 'x64') return 'windows-x64';
        if (arch === 'arm64') return 'windows-arm64';
        throw new Error(`Unsupported Windows architecture: ${arch}`);
    }

    if (platform === 'linux') {
        if (arch === 'x64') return 'linux-x64';
        if (arch === 'arm64') return 'linux-arm64';
        throw new Error(`Unsupported Linux architecture: ${arch}`);
    }

    if (platform === 'darwin') {
        if (arch === 'x64') return 'macos-x64';
        if (arch === 'arm64') return 'macos-arm64';
        throw new Error(`Unsupported macOS architecture: ${arch}`);
    }

    throw new Error(`Unsupported platform: ${platform}`);
}

async function readJson(filePath) {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function readPackageConfig() {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = await readJson(packageJsonPath);
    return packageJson.ffmpeg ?? {};
}

function resolveInstallDir(config) {
    const rawDir = process.env.FFMPEG_INSTALL_DIR || config.installDir || '.ffmpeg';
    return path.resolve(process.cwd(), rawDir);
}

function buildDefaultSource(target) {
    switch (target) {
        case 'windows-x64':
            return {
                provider: 'btbn',
                assetName: 'ffmpeg-master-latest-win64-gpl.zip',
                archiveType: 'zip',
                url: `${BTBN_DOWNLOAD_BASE}/latest/ffmpeg-master-latest-win64-gpl.zip`,
                checksumUrl: `${BTBN_DOWNLOAD_BASE}/latest/checksums.sha256`,
                checksumAssetName: 'ffmpeg-master-latest-win64-gpl.zip'
            };

        case 'windows-arm64':
            return {
                provider: 'btbn',
                assetName: 'ffmpeg-master-latest-winarm64-gpl.zip',
                archiveType: 'zip',
                url: `${BTBN_DOWNLOAD_BASE}/latest/ffmpeg-master-latest-winarm64-gpl.zip`,
                checksumUrl: `${BTBN_DOWNLOAD_BASE}/latest/checksums.sha256`,
                checksumAssetName: 'ffmpeg-master-latest-winarm64-gpl.zip'
            };

        case 'linux-x64':
            return {
                provider: 'btbn',
                assetName: 'ffmpeg-master-latest-linux64-gpl.tar.xz',
                archiveType: 'tar.xz',
                url: `${BTBN_DOWNLOAD_BASE}/latest/ffmpeg-master-latest-linux64-gpl.tar.xz`,
                checksumUrl: `${BTBN_DOWNLOAD_BASE}/latest/checksums.sha256`,
                checksumAssetName: 'ffmpeg-master-latest-linux64-gpl.tar.xz'
            };

        case 'linux-arm64':
            return {
                provider: 'btbn',
                assetName: 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz',
                archiveType: 'tar.xz',
                url: `${BTBN_DOWNLOAD_BASE}/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`,
                checksumUrl: `${BTBN_DOWNLOAD_BASE}/latest/checksums.sha256`,
                checksumAssetName: 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz'
            };

        case 'macos-x64':
        case 'macos-arm64':
            return {
                provider: 'evermeet',
                archiveType: 'zip',
                ffmpegUrl: EVERMEET_ZIP_FFMPEG,
                ffprobeUrl: EVERMEET_ZIP_FFPROBE
            };

        default:
            throw new Error(`Unsupported target: ${target}`);
    }
}

function buildSource(config, target) {
    const overrides = config.targets?.[target];
    if (overrides) {
        return {
            ...overrides,
            assetName: overrides.assetName ?? (overrides.url ? path.basename(new URL(overrides.url).pathname) : undefined)
        };
    }

    if (config.release && config.release !== 'latest') {
        throw new Error(
            `ffmpeg.release=${config.release} is not supported by the built-in resolver. ` +
            `Use ffmpeg.targets.${target} with explicit URLs for a pinned version.`
        );
    }

    return buildDefaultSource(target);
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

function getInstalledPaths(dir) {
    const ffmpegPath = path.join(dir, getExeName('ffmpeg'));
    const ffprobePath = path.join(dir, getExeName('ffprobe'));

    if (isExecutable(ffmpegPath) && isExecutable(ffprobePath)) {
        return { ffmpegPath, ffprobePath };
    }

    return null;
}

async function mkdirp(dirPath) {
    await fs.promises.mkdir(dirPath, { recursive: true });
}

async function removeSafe(dirPath) {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
}

async function writeExecutable(filePath) {
    if (process.platform !== 'win32') {
        await fs.promises.chmod(filePath, 0o755);
    }
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

        if (!process.stdout.isTTY) {
            return;
        }

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

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            ...options
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
            }
        });
    });
}

async function extractZip(archivePath, destinationDir) {
    await mkdirp(destinationDir);

    if (process.platform === 'win32') {
        const powershellExe = process.env.SystemRoot
            ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
            : 'powershell.exe';

        const escapePs = (value) => String(value).replace(/'/g, "''");

        const command = [
            `Expand-Archive`,
            `-LiteralPath '${escapePs(archivePath)}'`,
            `-DestinationPath '${escapePs(destinationDir)}'`,
            `-Force`
        ].join(' ');

        await run(powershellExe, [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-Command', command
        ]);

        return;
    }

    await run('unzip', ['-o', archivePath, '-d', destinationDir]);
}

async function extractTarXz(archivePath, destinationDir) {
    await mkdirp(destinationDir);
    await run('tar', ['-xJf', archivePath, '-C', destinationDir]);
}

function findFileRecursive(rootDir, fileNames) {
    const stack = [rootDir];

    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });

        for (const entry of entries) {
            const absolutePath = path.join(current, entry.name);

            if (entry.isDirectory()) {
                stack.push(absolutePath);
                continue;
            }

            if (fileNames.includes(entry.name)) {
                return absolutePath;
            }
        }
    }

    return null;
}

async function installFromBtbn(source, workDir, finalDir) {
    const archivePath = path.join(workDir, source.assetName);
    await downloadFile(source.url, archivePath, source.assetName);

    if (source.checksumUrl) {
        const checksums = parseChecksumFile(await fetchText(source.checksumUrl));
        const checksumKey = source.checksumAssetName ?? source.assetName;
        const expectedHash = checksums.get(checksumKey);

        if (!expectedHash) {
            throw new Error(`Checksum entry not found for ${checksumKey}`);
        }

        const actualHash = await sha256File(archivePath);
        if (actualHash !== expectedHash) {
            throw new Error(`Checksum mismatch for ${checksumKey}: expected ${expectedHash}, got ${actualHash}`);
        }
    }

    const unpackDir = path.join(workDir, 'unpack');

    if (source.archiveType === 'zip') {
        await extractZip(archivePath, unpackDir);
    } else if (source.archiveType === 'tar.xz') {
        await extractTarXz(archivePath, unpackDir);
    } else {
        throw new Error(`Unsupported archive type: ${source.archiveType}`);
    }

    const ffmpegSource = findFileRecursive(unpackDir, [getExeName('ffmpeg')]);
    const ffprobeSource = findFileRecursive(unpackDir, [getExeName('ffprobe')]);

    if (!ffmpegSource || !ffprobeSource) {
        throw new Error('ffmpeg or ffprobe was not found in the extracted archive');
    }

    await mkdirp(finalDir);

    const ffmpegPath = path.join(finalDir, getExeName('ffmpeg'));
    const ffprobePath = path.join(finalDir, getExeName('ffprobe'));

    await fs.promises.copyFile(ffmpegSource, ffmpegPath);
    await fs.promises.copyFile(ffprobeSource, ffprobePath);
    await writeExecutable(ffmpegPath);
    await writeExecutable(ffprobePath);

    return { ffmpegPath, ffprobePath };
}

async function installFromEvermeet(workDir, finalDir) {
    const ffmpegZipPath = path.join(workDir, 'ffmpeg-macos.zip');
    const ffprobeZipPath = path.join(workDir, 'ffprobe-macos.zip');

    await downloadFile(EVERMEET_ZIP_FFMPEG, ffmpegZipPath, 'ffmpeg-macos.zip');
    await downloadFile(EVERMEET_ZIP_FFPROBE, ffprobeZipPath, 'ffprobe-macos.zip');

    const unpackDir = path.join(workDir, 'unpack');
    await extractZip(ffmpegZipPath, unpackDir);
    await extractZip(ffprobeZipPath, unpackDir);

    const ffmpegSource = findFileRecursive(unpackDir, ['ffmpeg']);
    const ffprobeSource = findFileRecursive(unpackDir, ['ffprobe']);

    if (!ffmpegSource || !ffprobeSource) {
        throw new Error('ffmpeg or ffprobe was not found in the extracted macOS archives');
    }

    await mkdirp(finalDir);

    const ffmpegPath = path.join(finalDir, 'ffmpeg');
    const ffprobePath = path.join(finalDir, 'ffprobe');

    await fs.promises.copyFile(ffmpegSource, ffmpegPath);
    await fs.promises.copyFile(ffprobeSource, ffprobePath);
    await writeExecutable(ffmpegPath);
    await writeExecutable(ffprobePath);

    return { ffmpegPath, ffprobePath };
}

export async function ensureFfmpeg(options = {}) {
    const packageConfig = await readPackageConfig();
    const config = {
        ...packageConfig,
        ...options
    };

    const finalDir = resolveInstallDir(config);
    const stagingDir = `${finalDir}.staging`;
    const target = detectTarget();

    if (!config.force) {
        const cached = getInstalledPaths(finalDir);
        if (cached) {
            return cached;
        }
    }

    const source = buildSource(config, target);
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'installffmpeg-'));

    try {
        await removeSafe(stagingDir);

        const result = source.provider === 'evermeet'
            ? await installFromEvermeet(tempRoot, stagingDir)
            : await installFromBtbn(source, tempRoot, stagingDir);

        const metaPath = path.join(stagingDir, 'installffmpeg.json');
        await fs.promises.writeFile(metaPath, JSON.stringify({
            target,
            installedAt: new Date().toISOString(),
            source
        }, null, 4));

        await removeSafe(finalDir);
        await fs.promises.rename(stagingDir, finalDir);

        return {
            ffmpegPath: path.join(finalDir, path.basename(result.ffmpegPath)),
            ffprobePath: path.join(finalDir, path.basename(result.ffprobePath))
        };
    } catch (error) {
        await removeSafe(stagingDir);
        throw error;
    } finally {
        await removeSafe(tempRoot);
    }
}

async function main() {
    const result = await ensureFfmpeg({
        force: process.argv.includes('--force')
    });

    console.log(`ffmpeg:  ${result.ffmpegPath}`);
    console.log(`ffprobe: ${result.ffprobePath}`);
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryFilePath && currentFilePath === entryFilePath) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : error);
        process.exit(1);
    });
}