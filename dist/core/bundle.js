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
exports.collectExtraFiles = void 0;
exports.bundleSession = bundleSession;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const tar = __importStar(require("tar"));
const constants_1 = require("../shared/constants");
const bundle_1 = require("./agents/antigravity/bundle");
const bundle_2 = require("./agents/codex/bundle");
const extra_files_1 = require("./extra-files");
const fsutil_1 = require("./fsutil");
const paths_1 = require("./paths");
const scanner_1 = require("./scanner");
// Re-exported for back-compat with existing importers/tests.
var extra_files_2 = require("./extra-files");
Object.defineProperty(exports, "collectExtraFiles", { enumerable: true, get: function () { return extra_files_2.collectExtraFiles; } });
async function bundleSession(options) {
    const { sessionId, cwd } = options;
    const agentId = options.agentId ?? constants_1.DEFAULT_AGENT_ID;
    (0, constants_1.assertSupportedAgent)(agentId);
    if (agentId === "codex")
        return (0, bundle_2.bundleCodexSession)(options);
    if (agentId === "antigravity")
        return (0, bundle_1.bundleAntigravitySession)(options);
    const outputDir = options.outputDir ?? node_os_1.default.tmpdir();
    const claudeDir = options.claudeDir ?? constants_1.CLAUDE_DIR;
    const sourceUserDir = options.sourceUserDir ?? node_os_1.default.homedir();
    const encodedCwd = (0, paths_1.encodePath)(cwd);
    const projDir = node_path_1.default.join(claudeDir, "projects", encodedCwd);
    const jsonlPath = node_path_1.default.join(projDir, `${sessionId}.jsonl`);
    if (!node_fs_1.default.existsSync(jsonlPath)) {
        throw new Error(`Session JSONL not found at ${jsonlPath}`);
    }
    const stagingDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "codeteleport-"));
    try {
        // 1. Scan JSONL for assets + metadata
        const { assets, metadata } = await (0, scanner_1.scanSession)(jsonlPath);
        // 2. Write meta.json — self-describing: agentId lets pull pick the right
        // adapter without trusting the puller's local config.
        const meta = { sessionId, sourceCwd: cwd, sourceUserDir, agentId, formatVersion: constants_1.BUNDLE_FORMAT_VERSION };
        node_fs_1.default.writeFileSync(node_path_1.default.join(stagingDir, "meta.json"), JSON.stringify(meta, null, 2));
        // 3. Copy session JSONL
        node_fs_1.default.copyFileSync(jsonlPath, node_path_1.default.join(stagingDir, "session.jsonl"));
        // 4. Copy session subdirectory (subagents etc.)
        const sessionSubdir = node_path_1.default.join(projDir, sessionId);
        let subagentCount = 0;
        if (node_fs_1.default.existsSync(sessionSubdir) && node_fs_1.default.statSync(sessionSubdir).isDirectory()) {
            node_fs_1.default.cpSync(sessionSubdir, node_path_1.default.join(stagingDir, "session-subdir"), { recursive: true });
            // Count subagent JSONL files
            subagentCount = (0, fsutil_1.countFiles)(node_path_1.default.join(stagingDir, "session-subdir"), ".jsonl");
        }
        // 5. Copy file-history
        const fileHistoryDir = node_path_1.default.join(claudeDir, "file-history", sessionId);
        const hasFileHistory = node_fs_1.default.existsSync(fileHistoryDir);
        if (hasFileHistory) {
            node_fs_1.default.cpSync(fileHistoryDir, node_path_1.default.join(stagingDir, "file-history"), { recursive: true });
        }
        // 6. Copy session-env
        const sessionEnvDir = node_path_1.default.join(claudeDir, "session-env", sessionId);
        if (node_fs_1.default.existsSync(sessionEnvDir)) {
            node_fs_1.default.cpSync(sessionEnvDir, node_path_1.default.join(stagingDir, "session-env"), { recursive: true });
        }
        // 7. Copy paste-cache files
        const hasPasteCache = assets.pasteFiles.length > 0;
        if (hasPasteCache) {
            const pasteCacheDir = node_path_1.default.join(stagingDir, "paste-cache");
            node_fs_1.default.mkdirSync(pasteCacheDir, { recursive: true });
            for (const fname of assets.pasteFiles) {
                const src = node_path_1.default.join(claudeDir, "paste-cache", fname);
                if (node_fs_1.default.existsSync(src)) {
                    node_fs_1.default.copyFileSync(src, node_path_1.default.join(pasteCacheDir, fname));
                }
            }
        }
        // 8. Copy shell-snapshot files
        const hasShellSnapshots = assets.shellSnapshots.length > 0;
        if (hasShellSnapshots) {
            const shellDir = node_path_1.default.join(stagingDir, "shell-snapshots");
            node_fs_1.default.mkdirSync(shellDir, { recursive: true });
            for (const fname of assets.shellSnapshots) {
                const src = node_path_1.default.join(claudeDir, "shell-snapshots", fname);
                if (node_fs_1.default.existsSync(src)) {
                    node_fs_1.default.copyFileSync(src, node_path_1.default.join(shellDir, fname));
                }
            }
        }
        // 8b. Copy project memory (project-scoped, shared across sessions) — Part A.
        // An empty memory directory is treated as no memory (don't stage an empty dir).
        const memoryDir = node_path_1.default.join(projDir, "memory");
        const hasMemoryDir = node_fs_1.default.existsSync(memoryDir) && node_fs_1.default.statSync(memoryDir).isDirectory();
        const memoryFileCount = hasMemoryDir ? (0, fsutil_1.countFiles)(memoryDir, "") : 0;
        const hasMemory = memoryFileCount > 0;
        if (hasMemory) {
            node_fs_1.default.cpSync(memoryDir, node_path_1.default.join(stagingDir, "memory"), { recursive: true });
        }
        // 8c. Collect extra working/temp files — Part B
        const alreadyBundledRealRoots = [];
        for (const d of [sessionSubdir, fileHistoryDir]) {
            if (node_fs_1.default.existsSync(d)) {
                try {
                    alreadyBundledRealRoots.push(node_fs_1.default.realpathSync(d));
                }
                catch { }
            }
        }
        const extra = (0, extra_files_1.collectExtraFiles)({
            includePaths: options.includePaths ?? [],
            filesModified: metadata.filesModified ?? [],
            cwd,
            homeDir: sourceUserDir,
            stagingDir,
            alreadyBundledRealRoots,
        });
        if (extra.included.length > 0) {
            const manifest = extra.included.map((e) => ({
                stored: e.stored,
                originalPath: e.path,
                sizeBytes: e.sizeBytes,
                rewriteContent: false,
            }));
            node_fs_1.default.writeFileSync(node_path_1.default.join(stagingDir, "extra-files-manifest.json"), JSON.stringify(manifest, null, 2));
        }
        // 9. Create tar.gz
        const bundleFilename = `claude-session-${sessionId}.tar.gz`;
        const bundlePath = node_path_1.default.join(outputDir, bundleFilename);
        await tar.create({ gzip: true, file: bundlePath, cwd: stagingDir }, node_fs_1.default.readdirSync(stagingDir));
        // 10. Calculate checksum
        const checksum = await (0, fsutil_1.sha256File)(bundlePath);
        const sizeBytes = node_fs_1.default.statSync(bundlePath).size;
        const jsonlSizeBytes = node_fs_1.default.statSync(jsonlPath).size;
        // 11. Build project name from cwd
        const projectName = node_path_1.default.basename(cwd);
        return {
            bundlePath,
            sessionId,
            sourceCwd: cwd,
            sourceUserDir,
            sizeBytes,
            checksum: `sha256:${checksum}`,
            metadata: {
                ...metadata,
                agentId,
                projectName,
                jsonlSizeBytes,
                subagentCount,
                hasFileHistory,
                hasPasteCache,
                hasShellSnapshots,
                hasMemory,
                memoryFileCount: hasMemory ? memoryFileCount : undefined,
                extraFileCount: extra.included.length,
                extraFilesIncluded: extra.included.length > 0 ? extra.included.map((e) => e.path) : undefined,
            },
            extraFiles: {
                included: extra.included.map((e) => ({ path: e.path, sizeBytes: e.sizeBytes })),
                skipped: extra.skipped,
            },
        };
    }
    finally {
        node_fs_1.default.rmSync(stagingDir, { recursive: true, force: true });
    }
}
