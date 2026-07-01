"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.codexDirDefault = codexDirDefault;
exports.scanCodexLocalSessions = scanCodexLocalSessions;
exports.scanCodexProjectSessions = scanCodexProjectSessions;
exports.findCodexRolloutPath = findCodexRolloutPath;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../../paths");
const scanner_1 = require("./scanner");
/** Default Codex home: CODEX_HOME if set (official Codex behavior), else ~/.codex. */
function codexDirDefault() {
    const fromEnv = process.env.CODEX_HOME?.trim();
    return fromEnv ? fromEnv : node_path_1.default.join(node_os_1.default.homedir(), ".codex");
}
function walkRollouts(sessionsDir) {
    if (!node_fs_1.default.existsSync(sessionsDir))
        return [];
    const found = [];
    const walk = (dir) => {
        for (const entry of node_fs_1.default.readdirSync(dir, { withFileTypes: true })) {
            const abs = node_path_1.default.join(dir, entry.name);
            if (entry.isDirectory())
                walk(abs);
            else if (entry.isFile() && entry.name.endsWith(".jsonl"))
                found.push(abs);
        }
    };
    walk(sessionsDir);
    return found;
}
function toLocalSession(jsonlPath) {
    let scan;
    try {
        scan = (0, scanner_1.scanCodexSession)(jsonlPath);
    }
    catch {
        return null;
    }
    if (!scan.sessionId)
        return null;
    const cwd = scan.cwd || "";
    return {
        sessionId: scan.sessionId,
        projectPath: cwd,
        projectName: cwd ? node_path_1.default.basename(cwd) : "(unknown)",
        encodedProjectPath: "", // Codex doesn't dash-encode project dirs
        jsonlPath,
        sizeBytes: node_fs_1.default.statSync(jsonlPath).size,
        messageCount: scan.metadata.messageCount ?? 0,
        firstMessageAt: scan.metadata.sessionStartedAt ?? null,
        lastMessageAt: scan.metadata.sessionEndedAt ?? null,
    };
}
function sortByRecency(sessions) {
    return sessions.sort((a, b) => {
        const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bt - at;
    });
}
/** Scan all Codex rollouts under ~/.codex/sessions, newest first. */
function scanCodexLocalSessions(codexDir = codexDirDefault()) {
    const sessions = [];
    for (const file of walkRollouts(node_path_1.default.join(codexDir, "sessions"))) {
        const s = toLocalSession(file);
        if (s)
            sessions.push(s);
    }
    return sortByRecency(sessions);
}
/** Scan Codex rollouts for a single project cwd, newest first. */
function scanCodexProjectSessions(projectPath, codexDir = codexDirDefault()) {
    return scanCodexLocalSessions(codexDir).filter((s) => (0, paths_1.samePath)(s.projectPath, projectPath));
}
/** Locate a session's rollout JSONL by exact id or unambiguous prefix. */
function findCodexRolloutPath(sessionId, codexDir = codexDirDefault()) {
    for (const s of scanCodexLocalSessions(codexDir)) {
        if (s.sessionId === sessionId || s.sessionId.startsWith(sessionId))
            return s.jsonlPath;
    }
    return null;
}
