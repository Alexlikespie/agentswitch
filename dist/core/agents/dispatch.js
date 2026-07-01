"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanLocalSessionsForAgent = scanLocalSessionsForAgent;
exports.scanProjectSessionsForAgent = scanProjectSessionsForAgent;
exports.detectCurrentSessionForAgent = detectCurrentSessionForAgent;
const constants_1 = require("../../shared/constants");
const local_1 = require("../local");
const session_1 = require("../session");
const detect_1 = require("./antigravity/detect");
const local_2 = require("./antigravity/local");
const detect_2 = require("./codex/detect");
const local_3 = require("./codex/local");
/** List all local sessions for the configured agent. */
function scanLocalSessionsForAgent(agentId = constants_1.DEFAULT_AGENT_ID, dirs = {}) {
    (0, constants_1.assertSupportedAgent)(agentId);
    if (agentId === "codex")
        return (0, local_3.scanCodexLocalSessions)(dirs.codexDir);
    if (agentId === "antigravity")
        return (0, local_2.scanAntigravityLocalSessions)(dirs.geminiDir);
    return (0, local_1.scanLocalSessions)(dirs.claudeDir);
}
/** List local sessions for a single project cwd, for the configured agent. */
function scanProjectSessionsForAgent(agentId, projectPath, dirs = {}) {
    (0, constants_1.assertSupportedAgent)(agentId);
    if (agentId === "codex")
        return (0, local_3.scanCodexProjectSessions)(projectPath, dirs.codexDir);
    if (agentId === "antigravity")
        return (0, local_2.scanAntigravityProjectSessions)(projectPath, dirs.geminiDir);
    return (0, local_1.scanProjectSessions)(projectPath, dirs.claudeDir);
}
/**
 * Detect the current session for the configured agent. Claude uses the process
 * tree (cwd ignored); Codex uses history.jsonl rooted at cwd. Throws if none —
 * callers fall back to the interactive picker.
 */
function detectCurrentSessionForAgent(agentId, cwd = process.cwd(), dirs = {}) {
    (0, constants_1.assertSupportedAgent)(agentId);
    if (agentId === "codex")
        return (0, detect_2.detectCodexCurrentSession)(cwd, dirs.codexDir);
    if (agentId === "antigravity")
        return (0, detect_1.detectAntigravityCurrentSession)(cwd, dirs.geminiDir);
    return (0, session_1.detectCurrentSession)(undefined, dirs.claudeDir);
}
