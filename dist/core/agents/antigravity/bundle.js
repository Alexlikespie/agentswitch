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
exports.bundleAntigravitySession = bundleAntigravitySession;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const tar = __importStar(require("tar"));
const constants_1 = require("../../../shared/constants");
const extra_files_1 = require("../../extra-files");
const fsutil_1 = require("../../fsutil");
const sqlite_1 = require("../../sqlite");
const local_1 = require("./local");
/** Bundle an Antigravity conversation: its SQLite DB + the brain/<id> folder. */
async function bundleAntigravitySession(options) {
    const { sessionId, cwd } = options;
    const gemDir = options.geminiDir ?? (0, local_1.antigravityDirDefault)();
    const sourceUserDir = options.sourceUserDir ?? node_os_1.default.homedir();
    const outputDir = options.outputDir ?? node_os_1.default.tmpdir();
    const dbPath = (0, local_1.findAntigravityDbPath)(sessionId, gemDir);
    if (!dbPath) {
        throw new Error(`Antigravity conversation not found for ${sessionId} under ${node_path_1.default.join(gemDir, "conversations")}`);
    }
    const resolvedId = node_path_1.default.basename(dbPath, ".db");
    // Fold the WAL into the main DB so the copied file is complete.
    try {
        const db = (0, sqlite_1.openDb)(dbPath);
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        db.close();
    }
    catch { }
    const summary = (0, local_1.scanAntigravityLocalSessions)(gemDir).find((s) => s.sessionId === resolvedId);
    const stagingDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "codeteleport-agy-"));
    try {
        const meta = {
            sessionId: resolvedId,
            sourceCwd: cwd,
            sourceUserDir,
            agentId: "antigravity",
            formatVersion: constants_1.BUNDLE_FORMAT_VERSION,
            sourceGeminiHome: gemDir,
        };
        node_fs_1.default.writeFileSync(node_path_1.default.join(stagingDir, "meta.json"), JSON.stringify(meta, null, 2));
        node_fs_1.default.copyFileSync(dbPath, node_path_1.default.join(stagingDir, "session.db"));
        const brainSrc = node_path_1.default.join(gemDir, "brain", resolvedId);
        if (node_fs_1.default.existsSync(brainSrc)) {
            node_fs_1.default.cpSync(brainSrc, node_path_1.default.join(stagingDir, "brain"), { recursive: true });
        }
        // Part B: caller-supplied extra working/temp files (no auto-detection for Antigravity).
        const extra = (0, extra_files_1.collectExtraFiles)({
            includePaths: options.includePaths ?? [],
            filesModified: [],
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
        const bundlePath = node_path_1.default.join(outputDir, `antigravity-session-${resolvedId}.tar.gz`);
        await tar.create({ gzip: true, file: bundlePath, cwd: stagingDir }, node_fs_1.default.readdirSync(stagingDir));
        const checksum = await (0, fsutil_1.sha256File)(bundlePath);
        const sizeBytes = node_fs_1.default.statSync(bundlePath).size;
        return {
            bundlePath,
            sessionId: resolvedId,
            sourceCwd: cwd,
            sourceUserDir,
            sizeBytes,
            checksum: `sha256:${checksum}`,
            metadata: {
                agentId: "antigravity",
                projectName: node_path_1.default.basename(cwd),
                messageCount: summary?.messageCount,
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
