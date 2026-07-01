"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanLocalSessions = scanLocalSessions;
exports.scanProjectSessions = scanProjectSessions;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const constants_1 = require("../shared/constants");
const paths_1 = require("./paths");
function parseLine(line) {
    try {
        const obj = JSON.parse(line);
        return { timestamp: obj.timestamp || null, cwd: obj.cwd || null };
    }
    catch {
        return { timestamp: null, cwd: null };
    }
}
function scanDirectory(projectsDir, encodedFilter) {
    if (!node_fs_1.default.existsSync(projectsDir))
        return [];
    const sessions = [];
    const dirs = encodedFilter ? [encodedFilter] : node_fs_1.default.readdirSync(projectsDir);
    for (const encodedCwd of dirs) {
        const projDir = node_path_1.default.join(projectsDir, encodedCwd);
        if (!node_fs_1.default.existsSync(projDir) || !node_fs_1.default.statSync(projDir).isDirectory())
            continue;
        for (const file of node_fs_1.default.readdirSync(projDir)) {
            if (!file.endsWith(".jsonl"))
                continue;
            const sessionId = file.replace(".jsonl", "");
            const jsonlPath = node_path_1.default.join(projDir, file);
            const stat = node_fs_1.default.statSync(jsonlPath);
            const content = node_fs_1.default.readFileSync(jsonlPath, "utf-8");
            const lines = content.split("\n").filter((l) => l.length > 0);
            let firstMessageAt = null;
            let lastMessageAt = null;
            let projectPath = null;
            // Scan from start for first timestamp and cwd
            for (const line of lines) {
                const parsed = parseLine(line);
                if (parsed.timestamp && !firstMessageAt) {
                    firstMessageAt = parsed.timestamp;
                }
                if (parsed.cwd && !projectPath) {
                    projectPath = parsed.cwd;
                }
                if (firstMessageAt && projectPath)
                    break;
            }
            // Scan from end for last timestamp
            for (let i = lines.length - 1; i >= 0; i--) {
                const parsed = parseLine(lines[i]);
                if (parsed.timestamp) {
                    lastMessageAt = parsed.timestamp;
                    break;
                }
            }
            // Fall back to decoding directory name if cwd not found in JSONL. This is
            // display-only and lossy (encodePath is irreversible: "-" may have been a
            // separator, a drive colon, or a literal hyphen) — the in-JSONL cwd above is
            // the real source. The last "-" segment is still a usable project name.
            if (!projectPath) {
                projectPath = encodedCwd.replace(/-/g, "/");
            }
            // pathBasename understands both separators, so a foreign-OS cwd still resolves.
            const projectName = (0, paths_1.pathBasename)(projectPath);
            sessions.push({
                sessionId,
                projectPath,
                projectName,
                encodedProjectPath: encodedCwd,
                jsonlPath,
                sizeBytes: stat.size,
                messageCount: lines.length,
                firstMessageAt,
                lastMessageAt,
            });
        }
    }
    return sessions.sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
    });
}
/**
 * Scan ~/.claude/projects/ for all local AI coding sessions.
 * Returns sessions sorted by lastMessageAt descending (most recent first).
 */
function scanLocalSessions(claudeDir = constants_1.CLAUDE_DIR) {
    const projectsDir = node_path_1.default.join(claudeDir, "projects");
    return scanDirectory(projectsDir);
}
/**
 * Scan sessions for a specific project directory only.
 * Returns sessions sorted by lastMessageAt descending.
 */
function scanProjectSessions(projectPath, claudeDir = constants_1.CLAUDE_DIR) {
    const projectsDir = node_path_1.default.join(claudeDir, "projects");
    const encoded = (0, paths_1.encodePath)(projectPath);
    return scanDirectory(projectsDir, encoded);
}
