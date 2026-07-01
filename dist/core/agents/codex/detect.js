"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCodexCurrentSession = detectCodexCurrentSession;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const local_1 = require("./local");
/**
 * Detect the "current" Codex session for a directory.
 *
 * Codex exposes no PID/session file like Claude, so we use ~/.codex/history.jsonl
 * (rows of {session_id, ts, text}) — the most recent entry whose session is rooted
 * in `cwd` — and fall back to the newest local rollout for that cwd.
 */
function detectCodexCurrentSession(cwd = process.cwd(), codexDir = (0, local_1.codexDirDefault)()) {
    const sessions = (0, local_1.scanCodexLocalSessions)(codexDir); // newest first
    const byId = new Map(sessions.map((s) => [s.sessionId, s]));
    const historyPath = node_path_1.default.join(codexDir, "history.jsonl");
    if (node_fs_1.default.existsSync(historyPath)) {
        const lines = node_fs_1.default.readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
            let entry;
            try {
                entry = JSON.parse(lines[i]);
            }
            catch {
                continue;
            }
            const session = entry.session_id ? byId.get(entry.session_id) : undefined;
            if (session && session.projectPath === cwd) {
                return { sessionId: session.sessionId, cwd, pid: 0 };
            }
        }
    }
    const fallback = sessions.find((s) => s.projectPath === cwd);
    if (fallback)
        return { sessionId: fallback.sessionId, cwd, pid: 0 };
    throw new Error(`Could not find a Codex session for ${cwd}. Pass --session-id, or run from the project directory where you used Codex.`);
}
