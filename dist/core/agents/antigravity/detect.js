"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectAntigravityCurrentSession = detectAntigravityCurrentSession;
const local_1 = require("./local");
/**
 * Detect the current Antigravity conversation for a directory: the most recently
 * active conversation whose workspace matches `cwd` (recency comes from
 * history.jsonl). Throws if none — callers fall back to the interactive picker.
 */
function detectAntigravityCurrentSession(cwd = process.cwd(), gemDir = (0, local_1.antigravityDirDefault)()) {
    const match = (0, local_1.scanAntigravityLocalSessions)(gemDir).find((s) => s.projectPath === cwd);
    if (match)
        return { sessionId: match.sessionId, cwd, pid: 0 };
    throw new Error(`Could not find an Antigravity conversation for ${cwd}. Pass --session-id, or run from the project directory where you used Antigravity.`);
}
