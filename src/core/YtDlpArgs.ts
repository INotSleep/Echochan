import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_COOKIES_FILE_NAME = "cookies.txt";

function getYtDlpSharedArgs(): string[] {
    const args = [
        "--js-runtimes",
        "node"
    ];
    const cookiesPath = path.resolve(process.cwd(), DEFAULT_COOKIES_FILE_NAME);

    if (fs.existsSync(cookiesPath)) {
        args.push("--cookies", cookiesPath);
    }

    return args;
}

function prependYtDlpSharedArgs(args: string[]): string[] {
    return [
        ...getYtDlpSharedArgs(),
        ...args
    ];
}

export {
    getYtDlpSharedArgs,
    prependYtDlpSharedArgs
};
