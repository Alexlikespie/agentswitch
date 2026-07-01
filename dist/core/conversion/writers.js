"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeClaudeSession = writeClaudeSession;
exports.writeCodexSession = writeCodexSession;
exports.writeAntigravitySession = writeAntigravitySession;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const protobuf_1 = require("../agents/antigravity/protobuf");
const paths_1 = require("../paths");
const sqlite_1 = require("../sqlite");
const antigravity_fixtures_1 = require("./antigravity-fixtures");
// ── Claude Code writer ──────────────────────────────────────────────────────
/** Best-effort version/gitBranch from any existing local Claude session. */
function claudeDefaults(claudeDir) {
    const projects = node_path_1.default.join(claudeDir, "projects");
    try {
        for (const d of node_fs_1.default.readdirSync(projects)) {
            const dir = node_path_1.default.join(projects, d);
            if (!node_fs_1.default.statSync(dir).isDirectory())
                continue;
            for (const f of node_fs_1.default.readdirSync(dir)) {
                if (!f.endsWith(".jsonl"))
                    continue;
                const first = node_fs_1.default.readFileSync(node_path_1.default.join(dir, f), "utf-8").split("\n").find(Boolean);
                if (!first)
                    continue;
                const o = JSON.parse(first);
                return { version: o.version || "2.0.0", gitBranch: o.gitBranch || "main" };
            }
        }
    }
    catch { }
    return { version: "2.0.0", gitBranch: "main" };
}
/** Convert a canonical transcript into a resumable Claude Code session JSONL. */
function writeClaudeSession(transcript, opts) {
    const sessionId = node_crypto_1.default.randomUUID();
    const { cwd, claudeDir } = opts;
    const defaults = claudeDefaults(claudeDir);
    const version = opts.version ?? defaults.version;
    const gitBranch = opts.gitBranch ?? defaults.gitBranch;
    const projDir = node_path_1.default.join(claudeDir, "projects", (0, paths_1.encodePath)(cwd));
    node_fs_1.default.mkdirSync(projDir, { recursive: true });
    const installedTo = node_path_1.default.join(projDir, `${sessionId}.jsonl`);
    let parentUuid = null;
    const lines = [];
    for (const m of transcript.messages) {
        const uuid = node_crypto_1.default.randomUUID();
        const base = {
            parentUuid,
            isSidechain: false,
            userType: "external",
            cwd,
            sessionId,
            version,
            gitBranch,
            uuid,
            timestamp: new Date().toISOString(),
        };
        if (m.role === "user") {
            lines.push(JSON.stringify({ ...base, type: "user", message: { role: "user", content: m.text } }));
        }
        else {
            lines.push(JSON.stringify({
                ...base,
                type: "assistant",
                message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "text", text: m.text }] },
            }));
        }
        parentUuid = uuid;
    }
    node_fs_1.default.writeFileSync(installedTo, `${lines.join("\n")}\n`);
    return { sessionId, installedTo, resumeCommand: `claude --resume ${sessionId}` };
}
// ── Codex writer ─────────────────────────────────────────────────────────────
function firstCodexRollout(codexDir) {
    const base = node_path_1.default.join(codexDir, "sessions");
    if (!node_fs_1.default.existsSync(base))
        return null;
    const walk = (d) => node_fs_1.default.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const ab = node_path_1.default.join(d, e.name);
        return e.isDirectory() ? walk(ab) : e.name.endsWith(".jsonl") ? [ab] : [];
    });
    const files = walk(base);
    if (!files.length)
        return null;
    try {
        return node_fs_1.default
            .readFileSync(files[0], "utf-8")
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l));
    }
    catch {
        return null;
    }
}
/** session_meta + turn_context payloads — cloned from a real local rollout when present, else synthesized. */
function codexTemplates(codexDir, cwd) {
    const tpl = firstCodexRollout(codexDir);
    const metaTpl = tpl?.find((l) => l.type === "session_meta")?.payload;
    const turnTpl = tpl?.find((l) => l.type === "turn_context")?.payload;
    const meta = {
        ...(metaTpl ?? {
            originator: "codex-tui",
            cli_version: "0.140.0",
            source: "cli",
            thread_source: "user",
            model_provider: "openai",
        }),
        cwd,
    };
    const turn = {
        ...(turnTpl ?? {
            approval_policy: "on-request",
            sandbox_policy: {
                type: "workspace-write",
                network_access: false,
                exclude_tmpdir_env_var: false,
                exclude_slash_tmp: false,
            },
        }),
        cwd,
        workspace_roots: [cwd],
        turn_id: node_crypto_1.default.randomUUID(),
    };
    return { meta, turn };
}
function upsertCodexThread(db, codexDir, values) {
    const cols = db.columns("threads");
    if (cols.length === 0)
        return;
    // seed from an existing row so required columns get plausible values
    const tpl = (db.get("select * from threads limit 1") ?? {});
    const defaultSandboxPolicy = {
        type: "workspace-write",
        network_access: false,
        exclude_tmpdir_env_var: false,
        exclude_slash_tmp: false,
    };
    const row = {
        source: "cli",
        model_provider: "openai",
        sandbox_policy: defaultSandboxPolicy,
        approval_policy: "on-request",
        approval_mode: "on-request",
        ...tpl,
        ...values
    };
    const insertCols = Object.keys(row).filter((c) => cols.includes(c));
    if (!insertCols.includes("id"))
        return;
    const updates = insertCols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    const sql = `insert into threads (${insertCols.join(", ")}) values (${insertCols.map(() => "?").join(", ")}) on conflict(id) do update set ${updates.join(", ")}`;
    const toVal = (v) => v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : v;
    db.run(sql, ...insertCols.map((c) => toVal(row[c])));
}
/** Convert a canonical transcript into a resumable Codex session (rollout + thread row). */
function writeCodexSession(transcript, opts) {
    const sessionId = node_crypto_1.default.randomUUID();
    const { codexDir, cwd } = opts;
    const nowIso = new Date().toISOString();
    const { meta, turn } = codexTemplates(codexDir, cwd);
    const dateParts = nowIso.slice(0, 10).split("-");
    const rolloutDir = node_path_1.default.join(codexDir, "sessions", dateParts[0], dateParts[1], dateParts[2]);
    node_fs_1.default.mkdirSync(rolloutDir, { recursive: true });
    const installedTo = node_path_1.default.join(rolloutDir, `rollout-${nowIso.replace(/[:.]/g, "-")}-${sessionId}.jsonl`);
    const lines = [
        JSON.stringify({ timestamp: nowIso, type: "session_meta", payload: { ...meta, id: sessionId, timestamp: nowIso } }),
        JSON.stringify({ timestamp: nowIso, type: "turn_context", payload: turn }),
    ];
    for (const m of transcript.messages) {
        // response_item feeds model context on resume; event_msg drives the TUI history.
        lines.push(JSON.stringify({
            timestamp: nowIso,
            type: "response_item",
            payload: {
                type: "message",
                role: m.role,
                content: [{ type: m.role === "user" ? "input_text" : "output_text", text: m.text }],
                ...(m.role === "assistant" ? { phase: "final_answer" } : {}),
            },
        }));
        lines.push(JSON.stringify({
            timestamp: nowIso,
            type: "event_msg",
            payload: m.role === "user"
                ? { type: "user_message", message: m.text }
                : { type: "agent_message", message: m.text, phase: "final_answer" },
        }));
    }
    node_fs_1.default.writeFileSync(installedTo, `${lines.join("\n")}\n`);
    const dbPath = node_path_1.default.join(codexDir, "state_5.sqlite");
    if (node_fs_1.default.existsSync(dbPath)) {
        const db = (0, sqlite_1.openDb)(dbPath);
        try {
            const title = transcript.title ||
                transcript.messages.find((m) => m.role === "user")?.text?.slice(0, 80) ||
                "Converted session";
            const nowMs = Date.now();
            const nowSec = Math.floor(nowMs / 1000);
            upsertCodexThread(db, codexDir, {
                id: sessionId,
                rollout_path: installedTo,
                cwd,
                title,
                preview: title,
                first_user_message: title,
                created_at: nowSec,
                updated_at: nowSec,
                created_at_ms: nowMs,
                updated_at_ms: nowMs,
                archived: 0,
                archived_at: null,
            });
        }
        finally {
            db.close();
        }
    }
    return { sessionId, installedTo, resumeCommand: `codex resume ${sessionId}` };
}
// ── Antigravity writer ────────────────────────────────────────────────────────
/** Apply id/path/text swaps to a template protobuf blob. */
function rewriteAgyBlob(blob, swaps) {
    let buf = blob;
    for (const [from, to] of swaps)
        buf = (0, protobuf_1.rewriteProtobuf)(buf, from, to);
    return buf;
}
/**
 * Convert a canonical transcript into a resumable Antigravity conversation.
 *
 * Antigravity's session is a SQLite DB whose payloads are protobuf, with no .proto
 * we can build from scratch. So we clone real template step blobs (a user step and
 * an assistant step) and swap their ids, per-turn uuid, message text, and baked-in
 * paths via length-prefix-aware protobuf rewriting. Tool steps and gen_metadata are
 * omitted — agy renders history from the steps table and tolerates their absence.
 */
function writeAntigravitySession(transcript, opts) {
    const { geminiDir, cwd, userDir } = opts;
    const sessionId = node_crypto_1.default.randomUUID();
    const trajId = node_crypto_1.default.randomUUID();
    // Swaps applied to every cloned blob: identifiers + the template's baked-in paths.
    const baseSwaps = [
        [antigravity_fixtures_1.TEMPLATE.convId, sessionId],
        [antigravity_fixtures_1.TEMPLATE.trajId, trajId],
        [antigravity_fixtures_1.TEMPLATE.cwd, cwd],
        [antigravity_fixtures_1.TEMPLATE.userDir, userDir],
    ];
    const convDir = node_path_1.default.join(geminiDir, "conversations");
    node_fs_1.default.mkdirSync(convDir, { recursive: true });
    const installedTo = node_path_1.default.join(convDir, `${sessionId}.db`);
    // Start from a clean file (openDb opens read-write and creates it).
    node_fs_1.default.rmSync(installedTo, { force: true });
    const db = (0, sqlite_1.openDb)(installedTo);
    try {
        for (const stmt of antigravity_fixtures_1.ANTIGRAVITY_SCHEMA)
            db.exec(stmt);
        db.run(`pragma user_version = ${antigravity_fixtures_1.TEMPLATE.userVersion}`);
        db.run("insert into trajectory_meta (trajectory_id, cascade_id, trajectory_type, source) values (?, ?, ?, ?)", trajId, sessionId, antigravity_fixtures_1.TEMPLATE.trajectoryType, antigravity_fixtures_1.TEMPLATE.source);
        db.run("insert into trajectory_metadata_blob (id, data) values ('main', ?)", rewriteAgyBlob(antigravity_fixtures_1.TEMPLATE_BLOBS.trajectoryMeta, baseSwaps));
        db.run("insert into executor_metadata (idx, data) values (0, ?)", rewriteAgyBlob(antigravity_fixtures_1.TEMPLATE_BLOBS.executorMeta, baseSwaps));
        transcript.messages.forEach((m, idx) => {
            const isUser = m.role === "user";
            const template = isUser ? antigravity_fixtures_1.TEMPLATE_BLOBS.userStep : antigravity_fixtures_1.TEMPLATE_BLOBS.asstStep;
            const swaps = [
                ...baseSwaps,
                // Give each message its own turn id so steps stay independent.
                [antigravity_fixtures_1.TEMPLATE.turnUuid, node_crypto_1.default.randomUUID()],
                [isUser ? antigravity_fixtures_1.TEMPLATE.userText : antigravity_fixtures_1.TEMPLATE.asstText, m.text],
            ];
            db.run("insert into steps (idx, step_type, status, step_payload, step_format) values (?, ?, ?, ?, 0)", idx, isUser ? antigravity_fixtures_1.STEP_TYPE.user : antigravity_fixtures_1.STEP_TYPE.assistant, antigravity_fixtures_1.STEP_STATUS_DONE, rewriteAgyBlob(template, swaps));
        });
    }
    finally {
        db.close();
    }
    // Synthesize a matching brain transcript (step_index mirrors the DB idx). agy
    // renders from the DB, but Antigravity tooling also reads this for summaries.
    const logsDir = node_path_1.default.join(geminiDir, "brain", sessionId, ".system_generated", "logs");
    node_fs_1.default.mkdirSync(logsDir, { recursive: true });
    const nowIso = new Date().toISOString();
    const lines = transcript.messages.map((m, i) => m.role === "user"
        ? JSON.stringify({
            step_index: i,
            source: "USER_EXPLICIT",
            type: "USER_INPUT",
            status: "DONE",
            created_at: nowIso,
            content: `<USER_REQUEST>\n${m.text}\n</USER_REQUEST>`,
        })
        : JSON.stringify({
            step_index: i,
            source: "MODEL",
            type: "PLANNER_RESPONSE",
            status: "DONE",
            created_at: nowIso,
            content: m.text,
        }));
    const transcriptFile = `${lines.join("\n")}\n`;
    node_fs_1.default.writeFileSync(node_path_1.default.join(logsDir, "transcript.jsonl"), transcriptFile);
    node_fs_1.default.writeFileSync(node_path_1.default.join(logsDir, "transcript_full.jsonl"), transcriptFile);
    return { sessionId, installedTo, resumeCommand: `agy --conversation ${sessionId}` };
}
