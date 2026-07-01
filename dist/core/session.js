"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCurrentSession = detectCurrentSession;
exports.listLocalSessions = listLocalSessions;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const constants_1 = require("../shared/constants");
/**
 * Walk up the process tree from startPid, looking for a PID
 * that has a session file at ~/.claude/sessions/<pid>.json.
 * Max 5 levels up (claude → bash → this script).
 */
function detectCurrentSession(startPid, claudeDir = constants_1.CLAUDE_DIR) {
    let pid = startPid ?? process.ppid;
    let depth = 0;
    while (pid > 1 && depth < 5) {
        const sessionFile = node_path_1.default.join(claudeDir, "sessions", `${pid}.json`);
        if (node_fs_1.default.existsSync(sessionFile)) {
            const data = JSON.parse(node_fs_1.default.readFileSync(sessionFile, "utf-8"));
            return {
                sessionId: data.sessionId,
                cwd: data.cwd,
                pid,
            };
        }
        try {
            const ppid = (0, node_child_process_1.execSync)(`ps -o ppid= -p ${pid}`, { encoding: "utf-8" }).trim();
            pid = Number.parseInt(ppid, 10);
        }
        catch {
            break;
        }
        depth++;
    }
    throw new Error("Could not find a coding session in the process tree. Are you running this from inside your coding agent?");
}
/**
 * List recent sessions from ~/.claude/projects/ for manual selection.
 * Returns sessions sorted by modification time (newest first).
 */
function listLocalSessions(claudeDir = constants_1.CLAUDE_DIR) {
    const projectsDir = node_path_1.default.join(claudeDir, "projects");
    if (!node_fs_1.default.existsSync(projectsDir))
        return [];
    const sessions = [];
    for (const encodedCwd of node_fs_1.default.readdirSync(projectsDir)) {
        const projDir = node_path_1.default.join(projectsDir, encodedCwd);
        if (!node_fs_1.default.statSync(projDir).isDirectory())
            continue;
        for (const file of node_fs_1.default.readdirSync(projDir)) {
            if (!file.endsWith(".jsonl"))
                continue;
            const sessionId = file.replace(".jsonl", "");
            const stat = node_fs_1.default.statSync(node_path_1.default.join(projDir, file));
            // Decode the cwd from the directory name (reverse of encodePath)
            const cwd = encodedCwd.replace(/-/g, "/");
            sessions.push({ sessionId, cwd, modifiedAt: stat.mtime });
        }
    }
    return sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}
