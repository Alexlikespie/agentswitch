"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unbundleAntigravitySession = unbundleAntigravitySession;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../../paths");
const sqlite_1 = require("../../sqlite");
const protobuf_1 = require("./protobuf");
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;
const TEXT_EXTS = new Set([".jsonl", ".md", ".txt", ".json", ".sh", ".log"]);
/** Rewrite a protobuf blob; on a non-protobuf blob fall back to a binary-safe string replace. */
function rewriteBlob(buf, from, to) {
    if (!from || from === to)
        return buf;
    try {
        return (0, protobuf_1.rewriteProtobuf)(buf, from, to);
    }
    catch {
        const s = buf.toString("latin1");
        const out = (0, protobuf_1.rewritePathLeaf)(s, from, to);
        return out === s ? buf : Buffer.from(out, "latin1");
    }
}
function tableNames(db) {
    return db
        .all("select name from sqlite_master where type = 'table'")
        .map((r) => r.name)
        .filter((n) => SAFE_IDENTIFIER.test(n));
}
function blobColumns(db, table) {
    return db
        .all(`pragma table_info(${table})`)
        .filter((c) => String(c.type).toUpperCase() === "BLOB")
        .map((c) => c.name)
        .filter((n) => SAFE_IDENTIFIER.test(n));
}
/** Rewrite every path-bearing BLOB column across the whole conversation DB. */
function rewriteAllBlobs(dbPath, apply) {
    const db = (0, sqlite_1.openDb)(dbPath);
    try {
        for (const table of tableNames(db)) {
            const cols = blobColumns(db, table);
            if (cols.length === 0)
                continue;
            const rows = db.all(`select rowid as _rowid, ${cols.join(", ")} from ${table}`);
            for (const row of rows) {
                for (const col of cols) {
                    const value = row[col];
                    if (!Buffer.isBuffer(value))
                        continue;
                    const rewritten = apply(value);
                    if (!rewritten.equals(value)) {
                        db.run(`update ${table} set ${col} = ? where rowid = ?`, rewritten, row._rowid);
                    }
                }
            }
        }
    }
    finally {
        db.close();
    }
}
const JSON_EXTS = new Set([".jsonl", ".json"]);
function copyTreeRewritingText(src, dst, rewrite) {
    for (const entry of node_fs_1.default.readdirSync(src, { withFileTypes: true })) {
        const s = node_path_1.default.join(src, entry.name);
        const d = node_path_1.default.join(dst, entry.name);
        const ext = node_path_1.default.extname(entry.name).toLowerCase();
        if (entry.isDirectory()) {
            node_fs_1.default.mkdirSync(d, { recursive: true });
            copyTreeRewritingText(s, d, rewrite);
        }
        else if (TEXT_EXTS.has(ext)) {
            node_fs_1.default.writeFileSync(d, rewrite(node_fs_1.default.readFileSync(s, "utf-8"), JSON_EXTS.has(ext)));
        }
        else {
            node_fs_1.default.copyFileSync(s, d);
        }
    }
}
/** Install an Antigravity conversation from an already-extracted bundle staging dir. */
function unbundleAntigravitySession(args) {
    const { stagingDir, meta, options } = args;
    const sessionId = String(meta.sessionId);
    const sourceCwd = String(meta.sourceCwd ?? "");
    const sourceUserDir = String(meta.sourceUserDir ?? (0, paths_1.detectHomeDirSafe)(sourceCwd));
    let targetUserDir;
    let targetGeminiHome;
    let targetCwd;
    const defaultHome = (user) => node_path_1.default.join(user, ".gemini", "antigravity-cli");
    if (options.targetDir) {
        targetUserDir =
            options.targetUserDir ??
                (options.geminiDir ? (0, paths_1.detectHomeDirSafe)(options.geminiDir) : (0, paths_1.detectHomeDirSafe)(options.targetDir));
        targetGeminiHome = options.geminiDir ?? defaultHome(targetUserDir);
        targetCwd = options.targetDir;
    }
    else {
        targetUserDir = options.targetUserDir ?? node_os_1.default.homedir();
        targetGeminiHome = options.geminiDir ?? defaultHome(targetUserDir);
        targetCwd = (0, paths_1.rewritePathValue)(sourceCwd, sourceUserDir, targetUserDir);
    }
    const rewrittenSourceCwd = (0, paths_1.rewritePathValue)(sourceCwd, sourceUserDir, targetUserDir);
    const rewriteText = (content, jsonEscaped) => {
        let r = content;
        if (sourceUserDir !== targetUserDir)
            r = (0, paths_1.rewritePaths)(r, sourceUserDir, targetUserDir, { jsonEscaped });
        if (rewrittenSourceCwd !== targetCwd)
            r = (0, paths_1.rewritePaths)(r, rewrittenSourceCwd, targetCwd, { jsonEscaped });
        return r;
    };
    const rewriteBytes = (buf) => {
        let b = buf;
        if (sourceUserDir !== targetUserDir)
            b = rewriteBlob(b, sourceUserDir, targetUserDir);
        if (rewrittenSourceCwd !== targetCwd)
            b = rewriteBlob(b, rewrittenSourceCwd, targetCwd);
        return b;
    };
    // 1. Rewrite all protobuf blobs in the conversation DB (in staging), then install it.
    const stagedDb = node_path_1.default.join(stagingDir, "session.db");
    rewriteAllBlobs(stagedDb, rewriteBytes);
    const targetDbPath = node_path_1.default.join(targetGeminiHome, "conversations", `${sessionId}.db`);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(targetDbPath), { recursive: true });
    node_fs_1.default.copyFileSync(stagedDb, targetDbPath);
    // 2. Restore the brain folder, rewriting text files.
    const brainSrc = node_path_1.default.join(stagingDir, "brain");
    if (node_fs_1.default.existsSync(brainSrc)) {
        const brainDst = node_path_1.default.join(targetGeminiHome, "brain", sessionId);
        node_fs_1.default.mkdirSync(brainDst, { recursive: true });
        copyTreeRewritingText(brainSrc, brainDst, rewriteText);
    }
    const prefix = options.resumeCommandPrefix || "agy --conversation";
    return {
        sessionId,
        installedTo: targetDbPath,
        resumeCommand: `${prefix} ${sessionId}`,
    };
}
