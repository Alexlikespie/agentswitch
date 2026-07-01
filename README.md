# AgentSwitch

Offline session migration for LLM command-line tools.

AgentSwitch converts local session history between supported providers without uploading data to a cloud service or requiring an MCP server. It bundles a source session into a portable `session.tar.gz` archive, then restores it in the target provider's session format.

## Supported Providers

- `claude-code`
- `codex`
- `antigravity`

## Features

- Converts sessions locally and offline.
- Preserves messages, tool calls, files, and session metadata where supported.
- Automatically selects the most recent source session when no session ID is provided.
- Prints a resume command for the converted target session.

## Requirements

- Node.js 18 or newer
- npm

## Installation

```bash
git clone <repository-url>
cd agentswitch
npm install
npm run build
```

The compiled CLI is written to `dist/`.

## Usage

```bash
node ./dist/cli/convert.js -s <source> -t <target> [options]
```

You can also run the package binary after installation:

```bash
npx local-converter -s <source> -t <target> [options]
```

### Required Options

- `-s, --source <id>`: source provider identifier. Supported values are `claude-code`, `codex`, and `antigravity`.
- `-t, --target <id>`: target provider identifier. Supported values are `claude-code`, `codex`, and `antigravity`.

### Optional Options

- `-c, --cwd <dir>`: directory that contains the source session files. Defaults to the current working directory.
- `-i, --session <id>`: specific session ID to convert. If omitted, AgentSwitch selects the most recent session for the source provider.
- `-o, --bundle <file>`: path for the temporary bundle file. Defaults to `session.tar.gz` inside the working directory.

## Examples

Convert the most recent Antigravity session in the current project to Codex:

```bash
node ./dist/cli/convert.js -s antigravity -t codex
```

Convert a Codex session from another project directory to Claude Code:

```bash
node ./dist/cli/convert.js -s codex -t claude-code -c /path/to/project
```

Convert a specific session and write the temporary bundle to a custom location:

```bash
node ./dist/cli/convert.js \
  -s codex \
  -t antigravity \
  -i <session-id> \
  -o /path/to/session.tar.gz
```

## How It Works

1. AgentSwitch scans the source provider's local session storage for sessions associated with the selected working directory.
2. The selected session is bundled into a gzipped tar archive.
3. The bundle is restored into the target provider's local session layout.
4. Paths and provider-specific metadata are rewritten for the target environment where possible.
5. A resume command is printed so the converted session can be opened in the target CLI.

## Project Structure

```text
agentswitch/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── cli/
    │   └── convert.ts
    ├── core/
    └── shared/
```

## Development

```bash
npm install
npm run build
```

Run a local sanity check after building:

```bash
node ./dist/cli/convert.js -s codex -t antigravity -c /path/to/project
```

## Privacy

AgentSwitch is designed for local conversion. Session data is read from disk, written to a local bundle, and restored locally for the target provider. Review generated bundles before sharing them, because they may contain conversation history, file contents, and metadata from the converted session.

## License

This project includes code derived from CodeTeleport, which is MIT licensed. AgentSwitch maintains the same license.
