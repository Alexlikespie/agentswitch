"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.codexDirDefault = void 0;
exports.unbundleCodexSession = unbundleCodexSession;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../../paths");
const sqlite_1 = require("../../sqlite");
const local_1 = require("./local");
Object.defineProperty(exports, "codexDirDefault", { enumerable: true, get: function () { return local_1.codexDirDefault; } });
function toSqlValue(v) {
    if (v === null || v === undefined)
        return null;
    if (typeof v === "number" || typeof v === "bigint")
        return v;
    if (typeof v === "boolean")
        return v ? 1 : 0;
    if (typeof v === "string")
        return v;
    return JSON.stringify(v);
}
/** Upsert the threads row, writing only columns that exist in the (possibly evolved) schema. */
function upsertThread(db, values) {
    const cols = db.columns("threads");
    if (cols.length === 0)
        return;
    const insertCols = Object.keys(values).filter((c) => cols.includes(c));
    if (!insertCols.includes("id"))
        return;
    const updateCols = insertCols.filter((c) => c !== "id");
    const placeholders = insertCols.map(() => "?").join(", ");
    const sql = `insert into threads (${insertCols.join(", ")}) values (${placeholders}) ` +
        `on conflict(id) do update set ${updateCols.map((c) => `${c} = excluded.${c}`).join(", ")}`;
    db.run(sql, ...insertCols.map((c) => toSqlValue(values[c])));
}
function restoreDynamicTools(db, sessionId, tools) {
    if (db.columns("thread_dynamic_tools").length === 0)
        return;
    db.run("delete from thread_dynamic_tools where thread_id = ?", sessionId);
    for (const tool of tools) {
        const row = { ...tool, thread_id: sessionId };
        const cols = db.columns("thread_dynamic_tools").filter((c) => c in row);
        if (cols.length === 0)
            continue;
        const placeholders = cols.map(() => "?").join(", ");
        db.run(`insert into thread_dynamic_tools (${cols.join(", ")}) values (${placeholders})`, ...cols.map((c) => toSqlValue(row[c])));
    }
}
/** Install a Codex session from an already-extracted bundle staging dir. */
function unbundleCodexSession(args) {
    const { stagingDir, meta, options } = args;
    const sessionId = String(meta.sessionId);
    const sourceCwd = String(meta.sourceCwd ?? "");
    const sourceUserDir = String(meta.sourceUserDir ?? (0, paths_1.detectHomeDirSafe)(sourceCwd));
    // Resolve target paths (mirror of the Claude resolver, but anchored at ~/.codex).
    let targetUserDir;
    let targetCodexHome;
    let targetCwd;
    if (options.targetDir) {
        targetUserDir =
            options.targetUserDir ??
                (options.codexDir ? node_path_1.default.dirname(options.codexDir) : (0, paths_1.detectHomeDirSafe)(options.targetDir));
        targetCodexHome = options.codexDir ?? node_path_1.default.join(targetUserDir, ".codex");
        targetCwd = options.targetDir;
    }
    else {
        targetUserDir = options.targetUserDir ?? node_os_1.default.homedir();
        targetCodexHome = options.codexDir ?? node_path_1.default.join(targetUserDir, ".codex");
        targetCwd = (0, paths_1.rewritePathValue)(sourceCwd, sourceUserDir, targetUserDir);
    }
    const rewrittenSourceCwd = (0, paths_1.rewritePathValue)(sourceCwd, sourceUserDir, targetUserDir);
    const rewriteContent = (content, jsonEscaped) => {
        let r = content;
        if (sourceUserDir !== targetUserDir)
            r = (0, paths_1.rewritePaths)(r, sourceUserDir, targetUserDir, { jsonEscaped });
        if (rewrittenSourceCwd !== targetCwd)
            r = (0, paths_1.rewritePaths)(r, rewrittenSourceCwd, targetCwd, { jsonEscaped });
        return r;
    };
    // A SQLite string value: rewrite JSON-document values (e.g. sandbox_policy,
    // writable_roots) as escaped so they stay valid JSON; plain scalar paths (cwd,
    // rollout_path) as raw single-separator.
    const rewriteValue = (v) => {
        const t = v.trimStart();
        return rewriteContent(v, t.startsWith("{") || t.startsWith("["));
    };
    // 1. Write the rollout transcript at its target location, paths rewritten.
    const rolloutRel = meta.rolloutRelPath ||
        node_path_1.default.join("sessions", "imported", String(meta.rolloutFileName || `${sessionId}.jsonl`));
    const rolloutPath = node_path_1.default.join(targetCodexHome, rolloutRel);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(rolloutPath), { recursive: true });
    const sourceJsonl = node_fs_1.default.readFileSync(node_path_1.default.join(stagingDir, "session.jsonl"), "utf-8");
    node_fs_1.default.writeFileSync(rolloutPath, rewriteContent(sourceJsonl, true));
    // 2. Update Codex's local thread inventory (state_5.sqlite) if present.
    let codexStateApplied = false;
    const dbPath = node_path_1.default.join(targetCodexHome, "state_5.sqlite");
    if (node_fs_1.default.existsSync(dbPath)) {
        const statePath = node_path_1.default.join(stagingDir, "codex-state.json");
        const state = node_fs_1.default.existsSync(statePath)
            ? JSON.parse(node_fs_1.default.readFileSync(statePath, "utf-8"))
            : { threadRow: null, dynamicTools: [] };
        // Start from the source row (string values path-rewritten), then force the
        // machine-specific fields to the target.
        const base = {};
        for (const [k, v] of Object.entries(state.threadRow ?? {})) {
            base[k] = typeof v === "string" ? rewriteValue(v) : v;
        }
        const values = {
            source: "cli",
            model_provider: "openai",
            title: state.threadRow?.title ?? "Imported Codex chat",
            ...base,
            id: sessionId,
            cwd: targetCwd,
            rollout_path: rolloutPath,
        };
        let db;
        try {
            db = (0, sqlite_1.openDb)(dbPath);
            upsertThread(db, values);
            restoreDynamicTools(db, sessionId, state.dynamicTools ?? []);
            codexStateApplied = true;
        }
        finally {
            db?.close();
        }
    }
    const prefix = options.resumeCommandPrefix || "codex resume";
    return {
        sessionId,
        installedTo: rolloutPath,
        resumeCommand: `${prefix} ${sessionId}`,
        codexStateApplied,
    };
}
