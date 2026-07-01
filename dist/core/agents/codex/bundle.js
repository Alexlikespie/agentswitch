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
exports.bundleCodexSession = bundleCodexSession;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const tar = __importStar(require("tar"));
const constants_1 = require("../../../shared/constants");
const extra_files_1 = require("../../extra-files");
const fsutil_1 = require("../../fsutil");
const sqlite_1 = require("../../sqlite");
const local_1 = require("./local");
const scanner_1 = require("./scanner");
/**
 * Read the restore-relevant rows from Codex's state_5.sqlite. Best-effort: the
 * rollout JSONL is the source of truth, so a missing DB just yields empty state
 * (the row is reconstructed from the transcript on restore).
 */
function readCodexState(codexDir, sessionId) {
    const dbPath = node_path_1.default.join(codexDir, "state_5.sqlite");
    if (!node_fs_1.default.existsSync(dbPath))
        return { threadRow: null, dynamicTools: [] };
    let db;
    try {
        db = (0, sqlite_1.openDb)(dbPath, { readOnly: true });
        const threadRow = db.columns("threads").length > 0 ? (db.get("select * from threads where id = ?", sessionId) ?? null) : null;
        const dynamicTools = db.columns("thread_dynamic_tools").length > 0
            ? db.all("select * from thread_dynamic_tools where thread_id = ? order by position", sessionId)
            : [];
        return { threadRow: threadRow, dynamicTools };
    }
    catch {
        return { threadRow: null, dynamicTools: [] };
    }
    finally {
        db?.close();
    }
}
/** Bundle a Codex session (rollout transcript + restore-only SQLite state). */
async function bundleCodexSession(options) {
    const { sessionId, cwd } = options;
    const codexDir = options.codexDir ?? (0, local_1.codexDirDefault)();
    const sourceUserDir = options.sourceUserDir ?? node_os_1.default.homedir();
    const outputDir = options.outputDir ?? node_os_1.default.tmpdir();
    const rolloutPath = (0, local_1.findCodexRolloutPath)(sessionId, codexDir);
    if (!rolloutPath) {
        throw new Error(`Codex session rollout not found for ${sessionId} under ${node_path_1.default.join(codexDir, "sessions")}`);
    }
    const scan = (0, scanner_1.scanCodexSession)(rolloutPath);
    const state = readCodexState(codexDir, scan.sessionId || sessionId);
    const stagingDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "codeteleport-codex-"));
    try {
        const rolloutRelPath = node_path_1.default.relative(codexDir, rolloutPath).split(node_path_1.default.sep).join("/");
        const meta = {
            sessionId: scan.sessionId || sessionId,
            sourceCwd: cwd,
            sourceUserDir,
            agentId: "codex",
            formatVersion: constants_1.BUNDLE_FORMAT_VERSION,
            sourceCodexHome: codexDir,
            rolloutRelPath,
            rolloutFileName: node_path_1.default.basename(rolloutPath),
        };
        node_fs_1.default.writeFileSync(node_path_1.default.join(stagingDir, "meta.json"), JSON.stringify(meta, null, 2));
        node_fs_1.default.copyFileSync(rolloutPath, node_path_1.default.join(stagingDir, "session.jsonl"));
        node_fs_1.default.writeFileSync(node_path_1.default.join(stagingDir, "codex-state.json"), JSON.stringify(state, null, 2));
        // Part B: extra working/temp files (apply_patch-detected + caller includePaths).
        const extra = (0, extra_files_1.collectExtraFiles)({
            includePaths: options.includePaths ?? [],
            filesModified: scan.metadata.filesModified ?? [],
            cwd,
            homeDir: sourceUserDir,
            stagingDir,
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
        const bundlePath = node_path_1.default.join(outputDir, `codex-session-${meta.sessionId}.tar.gz`);
        await tar.create({ gzip: true, file: bundlePath, cwd: stagingDir }, node_fs_1.default.readdirSync(stagingDir));
        const checksum = await (0, fsutil_1.sha256File)(bundlePath);
        const sizeBytes = node_fs_1.default.statSync(bundlePath).size;
        const jsonlSizeBytes = node_fs_1.default.statSync(rolloutPath).size;
        return {
            bundlePath,
            sessionId: meta.sessionId,
            sourceCwd: cwd,
            sourceUserDir,
            sizeBytes,
            checksum: `sha256:${checksum}`,
            metadata: {
                ...scan.metadata,
                projectName: node_path_1.default.basename(cwd),
                jsonlSizeBytes,
                agentId: "codex",
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
