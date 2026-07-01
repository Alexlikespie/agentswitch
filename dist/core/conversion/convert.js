"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canConvert = canConvert;
exports.conversionTargetsFor = conversionTargetsFor;
exports.convertInStaging = convertInStaging;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const readers_1 = require("./readers");
const writers_1 = require("./writers");
/** Agents we can WRITE (convert into) — the full set, so any agent converts to any other. */
const WRITABLE_TARGETS = ["claude-code", "codex", "antigravity"];
/** Whether a source session can be converted into the target agent's format. */
function canConvert(sourceAgentId, targetAgentId) {
    if (sourceAgentId === targetAgentId)
        return false;
    return WRITABLE_TARGETS.includes(targetAgentId);
}
/** The agents a given source can be converted into. */
function conversionTargetsFor(sourceAgentId) {
    return WRITABLE_TARGETS.filter((t) => t !== sourceAgentId);
}
/** Read the source agent's session (from an extracted bundle staging dir) into the canonical IR. */
function readSource(sourceAgentId, stagingDir) {
    if (sourceAgentId === "codex") {
        return (0, readers_1.readCodexTranscript)(node_fs_1.default.readFileSync(node_path_1.default.join(stagingDir, "session.jsonl"), "utf-8"));
    }
    if (sourceAgentId === "antigravity") {
        const t = node_path_1.default.join(stagingDir, "brain", ".system_generated", "logs", "transcript.jsonl");
        return (0, readers_1.readAntigravityTranscript)(node_fs_1.default.existsSync(t) ? node_fs_1.default.readFileSync(t, "utf-8") : "");
    }
    // claude-code (and default)
    return (0, readers_1.readClaudeTranscript)(node_fs_1.default.readFileSync(node_path_1.default.join(stagingDir, "session.jsonl"), "utf-8"));
}
/**
 * Convert an extracted source bundle into a resumable session for the target
 * agent. Transcript-level + lossy by design. Throws if the pair is unsupported
 * (notably any target = antigravity).
 */
function convertInStaging(args) {
    const { sourceAgentId, targetAgentId, stagingDir, targetCwd, targetUserDir, claudeDir, codexDir, geminiDir } = args;
    if (!canConvert(sourceAgentId, targetAgentId)) {
        throw new Error(`Cannot convert ${sourceAgentId} → ${targetAgentId}. Conversion targets are: ${conversionTargetsFor(sourceAgentId).join(", ") || "(none)"}.`);
    }
    const transcript = readSource(sourceAgentId, stagingDir);
    if (targetAgentId === "codex")
        return (0, writers_1.writeCodexSession)(transcript, { codexDir, cwd: targetCwd });
    if (targetAgentId === "antigravity")
        return (0, writers_1.writeAntigravitySession)(transcript, { geminiDir, cwd: targetCwd, userDir: targetUserDir });
    return (0, writers_1.writeClaudeSession)(transcript, { claudeDir, cwd: targetCwd });
}
