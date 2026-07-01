"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgent = getAgent;
exports.getDefaultAgent = getDefaultAgent;
exports.getSupportedAgents = getSupportedAgents;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const AGENTS = {
    "claude-code": {
        id: "claude-code",
        name: "Claude Code",
        sessionDir: node_path_1.default.join(node_os_1.default.homedir(), ".claude", "projects"),
        sessionFilePattern: "*.jsonl",
        resumeCommand: "claude --resume",
        detectProcess: "claude",
        mcpAddCommand: "claude mcp add codeteleport -- codeteleport-mcp",
    },
    codex: {
        id: "codex",
        name: "Codex",
        sessionDir: node_path_1.default.join(node_os_1.default.homedir(), ".codex", "sessions"),
        sessionFilePattern: "**/*.jsonl",
        resumeCommand: "codex resume",
        detectProcess: "codex",
        mcpAddCommand: "codex mcp add codeteleport -- codeteleport-mcp",
    },
    antigravity: {
        id: "antigravity",
        name: "Antigravity",
        sessionDir: node_path_1.default.join(node_os_1.default.homedir(), ".gemini", "antigravity-cli", "conversations"),
        sessionFilePattern: "*.db",
        resumeCommand: "agy --conversation",
        detectProcess: "agy",
        mcpAddCommand: "agy mcp add codeteleport -- codeteleport-mcp",
    },
};
function getAgent(id) {
    const agentId = id || "claude-code";
    const agent = AGENTS[agentId];
    if (!agent) {
        throw new Error(`Unknown agent: ${agentId}. Supported: ${Object.keys(AGENTS).join(", ")}`);
    }
    return agent;
}
function getDefaultAgent() {
    return AGENTS["claude-code"];
}
function getSupportedAgents() {
    return Object.values(AGENTS);
}
