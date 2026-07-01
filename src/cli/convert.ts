import { Command } from "commander";
import { bundleSession } from "../core/bundle.js";
import { unbundleSession } from "../core/unbundle.js";
import { scanProjectSessions } from "../core/local.js";
import { scanCodexProjectSessions } from "../core/agents/codex/local.js";
import { scanAntigravityProjectSessions } from "../core/agents/antigravity/local.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const program = new Command();

program
  .name("local-converter")
  .description(
    "Convert an LLM‑CLI session from one provider to another using CodeTeleport core logic (offline)."
  )
  .requiredOption("-s, --source <id>", "source provider (claude-code|codex|antigravity)")
  .requiredOption("-t, --target <id>", "target provider (claude-code|codex|antigravity)")
  .option("-c, --cwd <dir>", "directory containing the source session (defaults to cwd)")
  .option("-i, --session <id>", "specific session ID to convert (defaults to the most recent session in CWD)")
  .option(
    "-o, --bundle <file>",
    "temporary bundle file path (default: ./session.tar.gz)"
  )
  .action(async (options) => {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const bundlePath = path.resolve(options.bundle ?? path.join(cwd, "session.tar.gz"));

    // 1. Resolve session ID
    let resolvedSessionId = options.session;
    if (!resolvedSessionId) {
      let sessions: Array<{ sessionId: string; lastMessageAt: string | null }> = [];
      if (options.source === "claude-code") {
        sessions = scanProjectSessions(cwd);
      } else if (options.source === "codex") {
        sessions = scanCodexProjectSessions(cwd);
      } else if (options.source === "antigravity") {
        sessions = scanAntigravityProjectSessions(cwd);
      } else {
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
    const bundleResult = await bundleSession({
      sessionId: resolvedSessionId,
      cwd,
      agentId: options.source,
      outputDir: path.dirname(bundlePath),
    });
    console.log(`✅ Bundle created at ${bundleResult.bundlePath}`);

    console.log(`🔀 Converting to ${options.target} ...`);
    const unbundleResult = await unbundleSession({
      bundlePath: bundleResult.bundlePath,
      convertTo: options.target,
      targetDir: cwd, // install into the same cwd on the target side
      targetUserDir: os.homedir(),
    });
    console.log(`✅ Conversion complete. Session installed to ${unbundleResult.installedTo}`);
    console.log(`Resume with: ${unbundleResult.resumeCommand}`);
  });

program.parseAsync(process.argv);
