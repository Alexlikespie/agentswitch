"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.antigravityDirDefault = antigravityDirDefault;
exports.scanAntigravityLocalSessions = scanAntigravityLocalSessions;
exports.scanAntigravityProjectSessions = scanAntigravityProjectSessions;
exports.findAntigravityDbPath = findAntigravityDbPath;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../../paths");
const sqlite_1 = require("../../sqlite");
/** Default Antigravity home (~/.gemini/antigravity-cli), overridable for tests. */
function antigravityDirDefault() {
    return node_path_1.default.join(node_os_1.default.homedir(), ".gemini", "antigravity-cli");
}
/** Map conversationId -> {workspace, latest ts, first display} from history.jsonl. */
function readHistory(gemDir) {
    const map = new Map();
    const file = node_path_1.default.join(gemDir, "history.jsonl");
    if (!node_fs_1.default.existsSync(file))
        return map;
    for (const line of node_fs_1.default.readFileSync(file, "utf-8").split("\n").filter(Boolean)) {
        let row;
        try {
            row = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (!row.conversationId)
            continue;
        const prev = map.get(row.conversationId);
        const ts = typeof row.timestamp === "number" ? row.timestamp : 0;
        map.set(row.conversationId, {
            workspace: row.workspace || prev?.workspace || "",
            lastTs: Math.max(ts, prev?.lastTs ?? 0),
            firstDisplay: prev?.firstDisplay || row.display || "",
        });
    }
    return map;
}
/** Extract the workspace path from the trajectory metadata protobuf blob (fallback). */
function workspaceFromBlob(dbPath) {
    try {
        const db = (0, sqlite_1.openDb)(dbPath, { readOnly: true });
        try {
            if (db.columns("trajectory_metadata_blob").length === 0)
                return "";
            const row = db.get("select data from trajectory_metadata_blob where id = 'main' limit 1");
            if (!row?.data)
                return "";
            // Capture the file:// path, then truncate at the first non-printable byte (blobs are binary).
            const m = Buffer.from(row.data)
                .toString("latin1")
                .match(/file:\/\/([^"'\s]+)/);
            if (!m)
                return "";
            let p = m[1];
            const bad = p.search(/[^\x20-\x7e]/);
            if (bad !== -1)
                p = p.slice(0, bad);
            // file:///C:/Users/x captures "/C:/Users/x" — drop the URI's leading slash(es)
            // before a Windows drive so the result is a real path ("C:/Users/x"), not "/C:/…".
            p = p.replace(/^\/+([A-Za-z]:)/, "$1");
            if (/^[A-Za-z]:/.test(p) || p.startsWith("\\\\"))
                return p; // Windows drive / UNC — leave as-is
            if (p.startsWith("//"))
                p = p.slice(2);
            return p.startsWith("/") ? p : `/${p}`;
        }
        finally {
            db.close();
        }
    }
    catch {
        return "";
    }
}
/** Count turns (USER_INPUT + PLANNER_RESPONSE) and grab the first prompt from a transcript. */
function transcriptSummary(gemDir, id) {
    const t = node_path_1.default.join(gemDir, "brain", id, ".system_generated", "logs", "transcript.jsonl");
    if (!node_fs_1.default.existsSync(t))
        return { messageCount: 0, title: "" };
    let messageCount = 0;
    let title = "";
    for (const line of node_fs_1.default.readFileSync(t, "utf-8").split("\n").filter(Boolean)) {
        try {
            const o = JSON.parse(line);
            if (o.type === "USER_INPUT" || o.type === "PLANNER_RESPONSE")
                messageCount++;
            if (o.type === "USER_INPUT" && !title)
                title = String(o.content || "").slice(0, 200);
        }
        catch { }
    }
    return { messageCount, title };
}
/** List Antigravity conversations, newest activity first. */
function scanAntigravityLocalSessions(gemDir = antigravityDirDefault()) {
    const convDir = node_path_1.default.join(gemDir, "conversations");
    if (!node_fs_1.default.existsSync(convDir))
        return [];
    const history = readHistory(gemDir);
    const sessions = [];
    for (const file of node_fs_1.default.readdirSync(convDir)) {
        if (!file.endsWith(".db"))
            continue;
        const sessionId = file.slice(0, -3);
        const dbPath = node_path_1.default.join(convDir, file);
        const h = history.get(sessionId);
        const cwd = h?.workspace || workspaceFromBlob(dbPath);
        const { messageCount } = transcriptSummary(gemDir, sessionId);
        const lastTs = h?.lastTs ?? node_fs_1.default.statSync(dbPath).mtimeMs;
        sessions.push({
            sessionId,
            projectPath: cwd,
            projectName: cwd ? node_path_1.default.basename(cwd) : "(unknown)",
            encodedProjectPath: "",
            jsonlPath: dbPath,
            sizeBytes: node_fs_1.default.statSync(dbPath).size,
            messageCount,
            firstMessageAt: null,
            lastMessageAt: lastTs ? new Date(lastTs).toISOString() : null,
            _ts: lastTs,
        });
    }
    return sessions.sort((a, b) => b._ts - a._ts).map(({ _ts, ...s }) => s);
}
/** List Antigravity conversations for a single project cwd, newest first. */
function scanAntigravityProjectSessions(projectPath, gemDir = antigravityDirDefault()) {
    return scanAntigravityLocalSessions(gemDir).filter((s) => (0, paths_1.samePath)(s.projectPath, projectPath));
}
/** Locate a conversation DB by exact id or unambiguous prefix. */
function findAntigravityDbPath(sessionId, gemDir = antigravityDirDefault()) {
    for (const s of scanAntigravityLocalSessions(gemDir)) {
        if (s.sessionId === sessionId || s.sessionId.startsWith(sessionId))
            return s.jsonlPath;
    }
    return null;
}
