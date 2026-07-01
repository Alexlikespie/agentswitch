"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unbundleSession = unbundleSession;
exports.isRestoreTargetSafe = isRestoreTargetSafe;
exports.installMemory = installMemory;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const tar = __importStar(require("tar"));
const agents_1 = require("../shared/agents");
const constants_1 = require("../shared/constants");
const unbundle_1 = require("./agents/antigravity/unbundle");
const unbundle_2 = require("./agents/codex/unbundle");
const convert_1 = require("./conversion/convert");
const paths_1 = require("./paths");
async function unbundleSession(options) {
    const { bundlePath } = options;
    const stagingDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "codeteleport-unpack-"));
    try {
        await tar.extract({ file: bundlePath, cwd: stagingDir });
        // Read meta.json
        const metaPath = node_path_1.default.join(stagingDir, "meta.json");
        if (!node_fs_1.default.existsSync(metaPath)) {
            throw new Error("meta.json not found in bundle — is this a valid CodeTeleport bundle?");
        }
        const meta = JSON.parse(node_fs_1.default.readFileSync(metaPath, "utf-8"));
        const { sessionId, sourceCwd, sourceUserDir } = meta;
        // Dispatch on the bundle's own agentId (not the puller's config). Bundles
        // made before this field existed are treated as claude-code.
        const agentId = meta.agentId ?? constants_1.DEFAULT_AGENT_ID;
        (0, constants_1.assertSupportedAgent)(agentId);
        // Cross-agent conversion (Model A): convert the pulled session into another
        // agent's format on install, instead of restoring it natively. Skipped when
        // convertTo equals the bundle's own agent.
        if (options.convertTo && options.convertTo !== agentId) {
            const targetUserDir = options.targetUserDir ?? node_os_1.default.homedir();
            const targetCwd = options.targetDir ?? (0, paths_1.rewritePathValue)(sourceCwd, sourceUserDir, targetUserDir);
            return (0, convert_1.convertInStaging)({
                sourceAgentId: agentId,
                targetAgentId: options.convertTo,
                stagingDir,
                targetCwd,
                targetUserDir,
                claudeDir: options.claudeDir ?? node_path_1.default.join(targetUserDir, ".claude"),
                codexDir: options.codexDir ?? node_path_1.default.join(targetUserDir, ".codex"),
                geminiDir: options.geminiDir ?? node_path_1.default.join(targetUserDir, ".gemini", "antigravity-cli"),
            });
        }
        // Resume command comes from the bundle's agent, not the puller's config.
        const resumePrefix = options.resumeCommandPrefix ?? (0, agents_1.getAgent)(agentId).resumeCommand;
        if (agentId === "codex") {
            return (0, unbundle_2.unbundleCodexSession)({ stagingDir, meta, options: { ...options, resumeCommandPrefix: resumePrefix } });
        }
        if (agentId === "antigravity") {
            return (0, unbundle_1.unbundleAntigravitySession)({
                stagingDir,
                meta,
                options: { ...options, resumeCommandPrefix: resumePrefix },
            });
        }
        // Determine target paths
        const targetDir = options.targetDir;
        let targetUserDir;
        let targetClaudeDir;
        let targetCwd;
        if (targetDir) {
            // targetDir mode: anchor session at the exact path specified
            if (options.targetUserDir) {
                targetUserDir = options.targetUserDir;
            }
            else if (options.claudeDir) {
                // Derive from claudeDir: /path/to/.claude → /path/to
                targetUserDir = node_path_1.default.dirname(options.claudeDir);
            }
            else {
                targetUserDir = (0, paths_1.detectHomeDirSafe)(targetDir);
            }
            targetClaudeDir = options.claudeDir ?? node_path_1.default.join(targetUserDir, ".claude");
            targetCwd = targetDir;
        }
        else {
            // Simple mode: just swap user dir. This assumes the project sits under the
            // home dir (the common case). A cross-OS project located OUTSIDE the home dir
            // (e.g. a different Windows drive like D:\…) has no sensible target location,
            // so rewritePathValue leaves it unchanged — pass --target-dir to anchor it.
            targetUserDir = options.targetUserDir ?? node_os_1.default.homedir();
            targetClaudeDir = options.claudeDir ?? node_path_1.default.join(targetUserDir, ".claude");
            targetCwd = (0, paths_1.rewritePathValue)(sourceCwd, sourceUserDir, targetUserDir);
        }
        const targetCwdEncoded = (0, paths_1.encodePath)(targetCwd);
        const targetProjDir = node_path_1.default.join(targetClaudeDir, "projects", targetCwdEncoded);
        node_fs_1.default.mkdirSync(targetProjDir, { recursive: true });
        // Two-pass path rewriting (matches scripts/unpack.sh):
        // Pass 1: Replace sourceUserDir → targetUserDir (handles cross-user paths)
        // Pass 2: Replace rewritten sourceCwd → targetCwd (handles project directory anchoring)
        // Use the same prefix-anchored rewrite so the cwd anchor matches what pass 1 produces.
        const rewrittenSourceCwd = (0, paths_1.rewritePathValue)(sourceCwd, sourceUserDir, targetUserDir);
        // Content rewriter. JSONL transcripts are jsonEscaped; Markdown/raw text is not.
        // Two passes: home dir → target home, then rewritten cwd → target cwd (project anchoring).
        function makeContentRewrite(jsonEscaped) {
            return (content) => {
                let result = content;
                if (sourceUserDir !== targetUserDir) {
                    result = (0, paths_1.rewritePaths)(result, sourceUserDir, targetUserDir, { jsonEscaped });
                }
                if (rewrittenSourceCwd !== targetCwd) {
                    result = (0, paths_1.rewritePaths)(result, rewrittenSourceCwd, targetCwd, { jsonEscaped });
                }
                return result;
            };
        }
        const jsonlRewrite = makeContentRewrite(true);
        const rawRewrite = makeContentRewrite(false);
        // Path-value rewriter for restore target paths (single native paths, not content).
        function twoPassValue(p) {
            let r = p;
            if (sourceUserDir !== targetUserDir)
                r = (0, paths_1.rewritePathValue)(r, sourceUserDir, targetUserDir);
            if (rewrittenSourceCwd !== targetCwd)
                r = (0, paths_1.rewritePathValue)(r, rewrittenSourceCwd, targetCwd);
            return r;
        }
        // 1. Install session JSONL with two-pass path rewriting
        const jsonlContent = node_fs_1.default.readFileSync(node_path_1.default.join(stagingDir, "session.jsonl"), "utf-8");
        node_fs_1.default.writeFileSync(node_path_1.default.join(targetProjDir, `${sessionId}.jsonl`), jsonlRewrite(jsonlContent));
        // 2. Install session subdirectory with path rewriting in JSONL files
        const sessionSubdir = node_path_1.default.join(stagingDir, "session-subdir");
        if (node_fs_1.default.existsSync(sessionSubdir)) {
            const targetSubdir = node_path_1.default.join(targetProjDir, sessionId);
            node_fs_1.default.cpSync(sessionSubdir, targetSubdir, { recursive: true });
            rewriteJsonlFilesInDir(targetSubdir, jsonlRewrite);
        }
        // 3. Install file-history
        const fileHistoryDir = node_path_1.default.join(stagingDir, "file-history");
        if (node_fs_1.default.existsSync(fileHistoryDir)) {
            const targetFH = node_path_1.default.join(targetClaudeDir, "file-history", sessionId);
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(targetFH), { recursive: true });
            node_fs_1.default.cpSync(fileHistoryDir, targetFH, { recursive: true });
        }
        // 4. Install session-env
        const sessionEnvDir = node_path_1.default.join(stagingDir, "session-env");
        if (node_fs_1.default.existsSync(sessionEnvDir)) {
            const targetSE = node_path_1.default.join(targetClaudeDir, "session-env", sessionId);
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(targetSE), { recursive: true });
            node_fs_1.default.cpSync(sessionEnvDir, targetSE, { recursive: true });
        }
        // 5. Install paste-cache files
        const pasteCacheDir = node_path_1.default.join(stagingDir, "paste-cache");
        if (node_fs_1.default.existsSync(pasteCacheDir)) {
            const targetPC = node_path_1.default.join(targetClaudeDir, "paste-cache");
            node_fs_1.default.mkdirSync(targetPC, { recursive: true });
            for (const fname of node_fs_1.default.readdirSync(pasteCacheDir)) {
                node_fs_1.default.copyFileSync(node_path_1.default.join(pasteCacheDir, fname), node_path_1.default.join(targetPC, fname));
            }
        }
        // 6. Install shell-snapshots
        const shellDir = node_path_1.default.join(stagingDir, "shell-snapshots");
        if (node_fs_1.default.existsSync(shellDir)) {
            const targetSS = node_path_1.default.join(targetClaudeDir, "shell-snapshots");
            node_fs_1.default.mkdirSync(targetSS, { recursive: true });
            for (const fname of node_fs_1.default.readdirSync(shellDir)) {
                node_fs_1.default.copyFileSync(node_path_1.default.join(shellDir, fname), node_path_1.default.join(targetSS, fname));
            }
        }
        // 7. Install project memory (Part A) with .md path rewriting
        let memoryInstalled;
        const memorySrc = node_path_1.default.join(stagingDir, "memory");
        if (node_fs_1.default.existsSync(memorySrc)) {
            const memoryDst = node_path_1.default.join(targetProjDir, "memory");
            node_fs_1.default.mkdirSync(memoryDst, { recursive: true });
            memoryInstalled = installMemory(memorySrc, memoryDst, rawRewrite, options.memoryConflict ?? "merge");
        }
        // 8. Install extra working/temp files (Part B) at their rewritten target paths
        let extraFilesInstalled;
        const manifestPath = node_path_1.default.join(stagingDir, "extra-files-manifest.json");
        if (node_fs_1.default.existsSync(manifestPath)) {
            extraFilesInstalled = [];
            const conflict = options.extraFilesConflict ?? "overwrite";
            // Also anchor encoded-cwd temp paths (e.g. /private/tmp/<encodedSourceCwd>/…) to the target.
            const encodedSourceCwd = (0, paths_1.encodePath)(sourceCwd);
            const encodedTargetCwd = (0, paths_1.encodePath)(targetCwd);
            // Allowed restore roots (literal + realpath): target cwd/.claude subtrees and temp roots.
            // On Windows, /tmp and /private/tmp resolve to real writable C:\tmp etc., so gate them out.
            const tempRoots = process.platform === "win32" ? [node_os_1.default.tmpdir()] : [node_os_1.default.tmpdir(), "/tmp", "/private/tmp"];
            const restoreRoots = Array.from(new Set([targetCwd, targetClaudeDir, ...tempRoots].flatMap((r) => [r, (0, paths_1.safeRealpath)(r)])));
            const manifest = JSON.parse(node_fs_1.default.readFileSync(manifestPath, "utf-8"));
            for (const entry of manifest) {
                const storedPath = node_path_1.default.join(stagingDir, "extra-files", entry.stored);
                if (!node_fs_1.default.existsSync(storedPath))
                    continue;
                let targetPath = twoPassValue(entry.originalPath);
                if (encodedSourceCwd !== encodedTargetCwd) {
                    targetPath = (0, paths_1.rewritePaths)(targetPath, encodedSourceCwd, encodedTargetCwd, { jsonEscaped: false });
                }
                // Refuse to write outside the allowed roots or to a sensitive location (untrusted manifest).
                if (!isRestoreTargetSafe(targetPath, restoreRoots, targetUserDir)) {
                    extraFilesInstalled.push({ path: targetPath, action: "skipped" });
                    continue;
                }
                const exists = node_fs_1.default.existsSync(targetPath);
                if (exists && conflict === "skip") {
                    extraFilesInstalled.push({ path: targetPath, action: "skipped" });
                    continue;
                }
                node_fs_1.default.mkdirSync(node_path_1.default.dirname(targetPath), { recursive: true });
                if (entry.rewriteContent) {
                    node_fs_1.default.writeFileSync(targetPath, rawRewrite(node_fs_1.default.readFileSync(storedPath, "utf-8")));
                }
                else {
                    node_fs_1.default.copyFileSync(storedPath, targetPath);
                }
                extraFilesInstalled.push({ path: targetPath, action: exists ? "overwritten" : "written" });
            }
        }
        return {
            sessionId,
            installedTo: targetProjDir,
            resumeCommand: `${resumePrefix} ${sessionId}`,
            memoryInstalled,
            extraFilesInstalled,
        };
    }
    finally {
        node_fs_1.default.rmSync(stagingDir, { recursive: true, force: true });
    }
}
/**
 * Whether an extra file from a (potentially untrusted) bundle may be written to `targetPath`.
 * Requires the resolved path to sit inside one of `allowedRoots` and not be a sensitive location.
 */
function isRestoreTargetSafe(targetPath, allowedRoots, homeDir) {
    const resolved = node_path_1.default.resolve(targetPath);
    if ((0, paths_1.isSensitivePath)(resolved, resolved, homeDir))
        return false;
    return allowedRoots.some((root) => (0, paths_1.isUnder)(resolved, root) || (0, paths_1.isUnder)(resolved, (0, paths_1.safeRealpath)(root)));
}
/**
 * Union two texts line-by-line, preserving order and de-duplicating. A single trailing
 * newline is preserved (and not treated as a blank content line) so merging real
 * newline-terminated MEMORY.md files doesn't inject stray blank lines.
 */
function unionByLine(existing, incoming) {
    const endsWithNewline = existing.endsWith("\n") || incoming.endsWith("\n");
    const toLines = (s) => {
        const lines = s.split("\n");
        if (lines.length > 0 && lines[lines.length - 1] === "")
            lines.pop();
        return lines;
    };
    const result = toLines(existing);
    const seen = new Set(result);
    for (const line of toLines(incoming)) {
        if (!seen.has(line)) {
            seen.add(line);
            result.push(line);
        }
    }
    return result.join("\n") + (endsWithNewline ? "\n" : "");
}
/**
 * Install project memory (Part A) from `memorySrc` into `memoryDst`.
 * `.md` contents are run through `rewrite` (they can embed absolute paths).
 * Conflict policy:
 *   - overwrite: replace target files
 *   - skip: keep existing target files
 *   - merge (default): union MEMORY.md by line; for any other file, write if
 *     absent else skip (never clobber a hand-edited memory on the target).
 */
function installMemory(memorySrc, memoryDst, rewrite, conflict) {
    const written = [];
    const merged = [];
    const skipped = [];
    const contentFor = (abs, isMd) => isMd ? rewrite(node_fs_1.default.readFileSync(abs, "utf-8")) : node_fs_1.default.readFileSync(abs);
    const walk = (dir, relBase) => {
        for (const entry of node_fs_1.default.readdirSync(dir, { withFileTypes: true })) {
            const abs = node_path_1.default.join(dir, entry.name);
            const rel = relBase ? node_path_1.default.join(relBase, entry.name) : entry.name;
            if (entry.isDirectory()) {
                walk(abs, rel);
                continue;
            }
            const dstFile = node_path_1.default.join(memoryDst, rel);
            const isMd = entry.name.toLowerCase().endsWith(".md");
            const exists = node_fs_1.default.existsSync(dstFile);
            const write = () => {
                node_fs_1.default.mkdirSync(node_path_1.default.dirname(dstFile), { recursive: true });
                node_fs_1.default.writeFileSync(dstFile, contentFor(abs, isMd));
            };
            if (conflict === "overwrite") {
                write();
                written.push(rel);
            }
            else if (conflict === "skip") {
                if (exists) {
                    skipped.push(rel);
                }
                else {
                    write();
                    written.push(rel);
                }
            }
            else if (entry.name === "MEMORY.md" && exists) {
                // merge: union MEMORY.md by line
                const incoming = isMd ? rewrite(node_fs_1.default.readFileSync(abs, "utf-8")) : node_fs_1.default.readFileSync(abs, "utf-8");
                node_fs_1.default.mkdirSync(node_path_1.default.dirname(dstFile), { recursive: true });
                node_fs_1.default.writeFileSync(dstFile, unionByLine(node_fs_1.default.readFileSync(dstFile, "utf-8"), incoming));
                merged.push(rel);
            }
            else if (exists) {
                // merge: never clobber an existing non-MEMORY memory file
                skipped.push(rel);
            }
            else {
                write();
                written.push(rel);
            }
        }
    };
    walk(memorySrc, "");
    return { written, merged, skipped };
}
function rewriteJsonlFilesInDir(dir, rewrite) {
    for (const entry of node_fs_1.default.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = node_path_1.default.join(dir, entry.name);
        if (entry.isDirectory()) {
            rewriteJsonlFilesInDir(fullPath, rewrite);
        }
        else if (entry.name.endsWith(".jsonl")) {
            const content = node_fs_1.default.readFileSync(fullPath, "utf-8");
            node_fs_1.default.writeFileSync(fullPath, rewrite(content));
        }
    }
}
