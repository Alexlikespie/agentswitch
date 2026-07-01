"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SENSITIVE_FILE_PATTERNS = exports.SENSITIVE_HOME_DIRS = exports.EXTRA_TOTAL_MAX_BYTES = exports.EXTRA_FILE_MAX_BYTES = exports.ANTIGRAVITY_DIR = exports.CODEX_DIR = exports.SUPPORTED_AGENT_IDS = exports.BUNDLE_FORMAT_VERSION = exports.DEFAULT_AGENT_ID = exports.API_URL = exports.CONFIG_FILE = exports.CONFIG_DIR = exports.CLAUDE_DIR = void 0;
exports.assertSupportedAgent = assertSupportedAgent;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
exports.CLAUDE_DIR = node_path_1.default.join(node_os_1.default.homedir(), ".claude");
/**
 * Config directory. Defaults to ~/.codeteleport, but can be redirected with the
 * CODETELEPORT_CONFIG_DIR env var so a session (e.g. the e2e harness, or a second
 * account) runs against an isolated config without touching the real one.
 */
exports.CONFIG_DIR = process.env.CODETELEPORT_CONFIG_DIR || node_path_1.default.join(node_os_1.default.homedir(), ".codeteleport");
exports.CONFIG_FILE = node_path_1.default.join(exports.CONFIG_DIR, "config.json");
exports.API_URL = "https://api.codeteleport.com/v1";
// ── Multi-agent bundling ──
/** Agent a bundle is assumed to come from when meta.json predates the agentId field. */
exports.DEFAULT_AGENT_ID = "claude-code";
/** Bundle envelope version. Bumped to 2 when meta.json gained agentId. */
exports.BUNDLE_FORMAT_VERSION = 2;
/**
 * Agent ids the bundler/unbundler can currently handle. Grows as adapters land
 * (claude-code today; codex next). Kept separate from the agent *registry*
 * (shared/agents.ts) so a registry entry can exist before its adapter does.
 */
exports.SUPPORTED_AGENT_IDS = ["claude-code", "codex", "antigravity"];
/** Codex home directory (~/.codex), overridable for tests. */
exports.CODEX_DIR = node_path_1.default.join(node_os_1.default.homedir(), ".codex");
/** Antigravity home directory (~/.gemini/antigravity-cli), overridable for tests. */
exports.ANTIGRAVITY_DIR = node_path_1.default.join(node_os_1.default.homedir(), ".gemini", "antigravity-cli");
/** Throw a consistent error for an agent id without a bundle/unbundle adapter. */
function assertSupportedAgent(agentId) {
    if (!exports.SUPPORTED_AGENT_IDS.includes(agentId)) {
        throw new Error(`Unknown agent: ${agentId}. Supported: ${exports.SUPPORTED_AGENT_IDS.join(", ")}`);
    }
}
// ── Extra working/temp file bundling (see spec: bundle memory + extra files) ──
/** Per-file size cap for bundled extra files. Files larger than this are skipped. */
exports.EXTRA_FILE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
/** Total size cap across all bundled extra files. Once hit, no more are added. */
exports.EXTRA_TOTAL_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
/**
 * Sensitive directory names, anchored under the user's home dir, whose contents
 * are NEVER bundled as extra files — even if they sit under an allowed parent.
 * e.g. ~/.ssh, ~/.aws, ~/.config, ~/.gnupg
 */
exports.SENSITIVE_HOME_DIRS = [".ssh", ".aws", ".config", ".gnupg"];
/**
 * Sensitive filename patterns (matched against the basename). Any extra-file
 * candidate whose name matches is hard-rejected regardless of location.
 * Covers private keys (*.pem/*.key/*.p12/*.pfx/*.pkcs8/*.p8/*.jks/*.keystore,
 * id_rsa/dsa/ecdsa/ed25519), env files, and common credential files
 * (.netrc, .npmrc, AWS-style `credentials`).
 */
exports.SENSITIVE_FILE_PATTERNS = [
    /\.pem$/i,
    /\.key$/i,
    /\.(p12|pfx|pkcs8|p8|jks|keystore)$/i,
    /^\.env/i,
    /^id_(rsa|dsa|ecdsa|ed25519)/i,
    /^\.netrc$/i,
    /^\.npmrc$/i,
    /^credentials$/i,
];
