"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSession = scanSession;
const node_fs_1 = __importDefault(require("node:fs"));
const node_readline_1 = __importDefault(require("node:readline"));
/**
 * Scan a session JSONL file for referenced assets and extract metadata.
 */
async function scanSession(jsonlPath) {
    const pasteFiles = new Set();
    const shellSnapshots = new Set();
    const filesModified = new Set();
    const pasteRegex = /paste-cache\/([a-zA-Z0-9]+\.txt)/g;
    const shellRegex = /snapshot-zsh-\d+-\w+\.sh/g;
    let messageCount = 0;
    let userMessageCount = 0;
    let assistantMessageCount = 0;
    let toolCallCount = 0;
    let firstTimestamp;
    let lastTimestamp;
    let claudeModel;
    let summary;
    const content = node_fs_1.default.readFileSync(jsonlPath, "utf-8").trim();
    if (!content) {
        return {
            assets: { pasteFiles: [], shellSnapshots: [] },
            metadata: { messageCount: 0 },
        };
    }
    const fileStream = node_fs_1.default.createReadStream(jsonlPath);
    const rl = node_readline_1.default.createInterface({ input: fileStream });
    for await (const line of rl) {
        if (!line.trim())
            continue;
        let entry;
        try {
            entry = JSON.parse(line);
        }
        catch {
            continue;
        }
        const type = entry.type;
        if (!type || !["user", "assistant", "progress", "system"].includes(type))
            continue;
        messageCount++;
        if (type === "user")
            userMessageCount++;
        if (type === "assistant")
            assistantMessageCount++;
        // Timestamps
        const timestamp = entry.timestamp;
        if (timestamp) {
            if (!firstTimestamp)
                firstTimestamp = timestamp;
            lastTimestamp = timestamp;
        }
        // Model
        if (!claudeModel && entry.model) {
            claudeModel = entry.model;
        }
        // Summary from first user message
        if (!summary && type === "user") {
            const msg = entry.message;
            if (msg?.content && typeof msg.content === "string") {
                summary = msg.content.slice(0, 200);
            }
        }
        // Tool calls
        const toolCalls = entry.toolCalls;
        if (toolCalls && Array.isArray(toolCalls)) {
            toolCallCount += toolCalls.length;
            for (const tc of toolCalls) {
                const name = tc.name;
                const input = tc.input;
                if (name && ["Edit", "Write"].includes(name) && input?.file_path) {
                    filesModified.add(input.file_path);
                }
            }
        }
        // Asset scanning
        const text = JSON.stringify(entry);
        let match;
        // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
        while ((match = pasteRegex.exec(text)) !== null) {
            pasteFiles.add(match[1]);
        }
        pasteRegex.lastIndex = 0;
        // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
        while ((match = shellRegex.exec(text)) !== null) {
            shellSnapshots.add(match[0]);
        }
        shellRegex.lastIndex = 0;
    }
    let durationSeconds;
    if (firstTimestamp && lastTimestamp) {
        durationSeconds = Math.round((new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 1000);
    }
    const sortedFiles = Array.from(filesModified).sort();
    return {
        assets: {
            pasteFiles: Array.from(pasteFiles).sort(),
            shellSnapshots: Array.from(shellSnapshots).sort(),
        },
        metadata: {
            messageCount,
            userMessageCount,
            assistantMessageCount,
            toolCallCount,
            sessionStartedAt: firstTimestamp,
            sessionEndedAt: lastTimestamp,
            durationSeconds,
            claudeModel,
            summary,
            filesModified: sortedFiles.length > 0 ? sortedFiles : undefined,
            filesModifiedCount: sortedFiles.length > 0 ? sortedFiles.length : undefined,
        },
    };
}
