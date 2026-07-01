"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectExtraFiles = collectExtraFiles;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const constants_1 = require("../shared/constants");
const paths_1 = require("./paths");
/**
 * Collect working/temp files to bundle (Part B). Filters the union of caller-supplied
 * includePaths and scanner-detected filesModified through an allowlist + sensitive
 * deny-list + size caps + dedupe, copying survivors into `<stagingDir>/extra-files/`.
 *
 * Agent-agnostic: shared by every adapter's bundle step.
 */
function collectExtraFiles(params) {
    const { includePaths, filesModified, cwd, homeDir, stagingDir, alreadyBundledRealRoots = [], perFileMax = constants_1.EXTRA_FILE_MAX_BYTES, totalMax = constants_1.EXTRA_TOTAL_MAX_BYTES, } = params;
    const allowedRoots = (params.allowedRoots ?? [cwd, node_os_1.default.tmpdir(), "/tmp", "/private/tmp"]).map(paths_1.safeRealpath);
    const bundledRoots = alreadyBundledRealRoots.map(paths_1.safeRealpath);
    const included = [];
    const skipped = [];
    // Union, includePaths first, deduped by resolved original path.
    // Relative paths anchor to the session cwd (not the bundler's process.cwd()).
    const seenOriginal = new Set();
    const candidates = [];
    for (const p of [...includePaths, ...filesModified]) {
        const resolved = node_path_1.default.resolve(cwd, p);
        if (seenOriginal.has(resolved))
            continue;
        seenOriginal.add(resolved);
        candidates.push(resolved);
    }
    const seenReal = new Set();
    const extraDir = node_path_1.default.join(stagingDir, "extra-files");
    let runningTotal = 0;
    for (const original of candidates) {
        let stat;
        try {
            stat = node_fs_1.default.statSync(original); // follows symlinks; throws on missing / broken link
        }
        catch {
            skipped.push({ path: original, reason: "not found" });
            continue;
        }
        if (!stat.isFile()) {
            skipped.push({ path: original, reason: "not a regular file" });
            continue;
        }
        const realPath = (0, paths_1.safeRealpath)(original);
        if ((0, paths_1.isSensitivePath)(original, realPath, homeDir)) {
            skipped.push({ path: original, reason: "sensitive path" });
            continue;
        }
        if (!allowedRoots.some((root) => (0, paths_1.isUnder)(realPath, root))) {
            skipped.push({ path: original, reason: "outside allowed roots" });
            continue;
        }
        if (bundledRoots.some((root) => (0, paths_1.isUnder)(realPath, root))) {
            skipped.push({ path: original, reason: "already in bundle" });
            continue;
        }
        if (seenReal.has(realPath))
            continue; // duplicate of an already-included file
        if (stat.size > perFileMax) {
            skipped.push({ path: original, reason: "exceeds per-file size cap" });
            continue;
        }
        if (runningTotal + stat.size > totalMax) {
            skipped.push({ path: original, reason: "exceeds total size cap" });
            continue;
        }
        seenReal.add(realPath);
        node_fs_1.default.mkdirSync(extraDir, { recursive: true });
        const stored = node_crypto_1.default.createHash("sha1").update(original).digest("hex");
        node_fs_1.default.copyFileSync(realPath, node_path_1.default.join(extraDir, stored));
        runningTotal += stat.size;
        included.push({ path: original, sizeBytes: stat.size, stored });
    }
    return { included, skipped };
}
