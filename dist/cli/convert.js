"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const bundle_js_1 = require("../core/bundle.js");
const unbundle_js_1 = require("../core/unbundle.js");
const local_js_1 = require("../core/local.js");
const local_js_2 = require("../core/agents/codex/local.js");
const local_js_3 = require("../core/agents/antigravity/local.js");
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const program = new commander_1.Command();
program
    .name("local-converter")
    .description("Convert an LLM‑CLI session from one provider to another using CodeTeleport core logic (offline).")
    .requiredOption("-s, --source <id>", "source provider (claude-code|codex|antigravity)")
    .requiredOption("-t, --target <id>", "target provider (claude-code|codex|antigravity)")
    .option("-c, --cwd <dir>", "directory containing the source session (defaults to cwd)")
    .option("-i, --session <id>", "specific session ID to convert (defaults to the most recent session in CWD)")
    .option("-o, --bundle <file>", "temporary bundle file path (default: ./session.tar.gz)")
    .action(async (options) => {
    const cwd = node_path_1.default.resolve(options.cwd ?? process.cwd());
    const bundlePath = node_path_1.default.resolve(options.bundle ?? node_path_1.default.join(cwd, "session.tar.gz"));
    // 1. Resolve session ID
    let resolvedSessionId = options.session;
    if (!resolvedSessionId) {
        let sessions = [];
        if (options.source === "claude-code") {
            sessions = (0, local_js_1.scanProjectSessions)(cwd);
        }
        else if (options.source === "codex") {
            sessions = (0, local_js_2.scanCodexProjectSessions)(cwd);
        }
        else if (options.source === "antigravity") {
            sessions = (0, local_js_3.scanAntigravityProjectSessions)(cwd);
        }
        else {
            console.error(`❌ Unsupported source agent: "${options.source}"`);
            process.exit(1);
        }
        if (sessions.length === 0) {
            console.error(`❌ No sessions found for provider "${options.source}" in directory "${cwd}".`);
            console.error("Please run the source agent first to create a session, or specify a session ID manually with -i.");
            process.exit(1);
        }
        resolvedSessionId = sessions[0].sessionId;
        console.log(`🔍 Auto-detected ${sessions.length} session(s) in this directory. Using the most recent: "${resolvedSessionId}"`);
    }
    console.log(`📦 Bundling ${options.source} session "${resolvedSessionId}" from ${cwd} → ${bundlePath}`);
    const bundleResult = await (0, bundle_js_1.bundleSession)({
        sessionId: resolvedSessionId,
        cwd,
        agentId: options.source,
        outputDir: node_path_1.default.dirname(bundlePath),
    });
    console.log(`✅ Bundle created at ${bundleResult.bundlePath}`);
    console.log(`🔀 Converting to ${options.target} ...`);
    const unbundleResult = await (0, unbundle_js_1.unbundleSession)({
        bundlePath: bundleResult.bundlePath,
        convertTo: options.target,
        targetDir: cwd, // install into the same cwd on the target side
        targetUserDir: node_os_1.default.homedir(),
    });
    console.log(`✅ Conversion complete. Session installed to ${unbundleResult.installedTo}`);
    console.log(`Resume with: ${unbundleResult.resumeCommand}`);
});
program.parseAsync(process.argv);
