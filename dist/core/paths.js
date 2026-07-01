"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodePath = encodePath;
exports.safeRealpath = safeRealpath;
exports.isUnder = isUnder;
exports.isSensitivePath = isSensitivePath;
exports.isWindowsStyle = isWindowsStyle;
exports.pathBasename = pathBasename;
exports.rewritePathValue = rewritePathValue;
exports.rewritePaths = rewritePaths;
exports.detectHomeDir = detectHomeDir;
exports.detectHomeDirSafe = detectHomeDirSafe;
exports.samePath = samePath;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const constants_1 = require("../shared/constants");
/**
 * Encode a filesystem path the way Claude Code names project directories: path
 * separators collapse to "-", and a Windows drive colon ("C:") also collapses.
 *   "/Users/alice/myproject"       → "-Users-alice-myproject"
 *   "C:\\Users\\alice\\myproject"  → "C--Users-alice-myproject"  (verified ground truth)
 * A POSIX mid-path ":" is left untouched — only the drive-letter colon is mapped,
 * since whether macOS/Linux Claude Code encodes a mid-path ":" is unconfirmed.
 */
function encodePath(fsPath) {
    // Drop a Windows extended-length / device prefix (\\?\, \\.\) so it can't
    // produce an illegal "?" in the directory name.
    const stripped = fsPath.replace(/^\\\\[?.]\\/, "");
    // Drive-letter colon → "-" (C:\… → C-\… → C--…), then every separator → "-".
    return stripped.replace(/^([A-Za-z]):/, "$1-").replace(/[/\\]/g, "-");
}
/** Resolve a path's real location, falling back to the input if it can't be resolved. */
function safeRealpath(p) {
    try {
        return node_fs_1.default.realpathSync(p);
    }
    catch {
        return p;
    }
}
/** True if `child` is `parent` or sits inside it (prefix match on a path boundary). */
function isUnder(child, parent) {
    // Windows filesystems are case-insensitive, so compare case-insensitively there —
    // otherwise the sensitive-path deny-list misses differently-cased secret dirs
    // (e.g. ~/.SSH, ~/.AWS, ~/.Config). On case-sensitive POSIX, stay exact.
    const ci = process.platform === "win32";
    const c = ci ? child.toLowerCase() : child;
    const p = ci ? parent.toLowerCase() : parent;
    if (c === p)
        return true;
    const withSep = p.endsWith(node_path_1.default.sep) ? p : p + node_path_1.default.sep;
    return c.startsWith(withSep);
}
/**
 * Hard deny-list: secrets/keys must never travel (on bundle) nor be written (on restore),
 * even from/to an allowed root. Matches sensitive filename patterns anywhere and the
 * home-anchored sensitive directories (~/.ssh, ~/.aws, ~/.config, ~/.gnupg).
 */
function isSensitivePath(originalPath, realPath, homeDir) {
    // Use both the OS basename and a separator-agnostic basename so a foreign-OS
    // path (e.g. a Windows path being checked on Linux) still surfaces its filename.
    const bases = [
        node_path_1.default.basename(originalPath),
        node_path_1.default.basename(realPath),
        pathBasename(originalPath),
        pathBasename(realPath),
    ];
    for (const pattern of constants_1.SENSITIVE_FILE_PATTERNS) {
        if (bases.some((b) => pattern.test(b)))
            return true;
    }
    for (const dir of constants_1.SENSITIVE_HOME_DIRS) {
        const root = node_path_1.default.join(homeDir, dir);
        if (isUnder(originalPath, root) || isUnder(realPath, root))
            return true;
    }
    return false;
}
/**
 * Whether a path string is Windows-style: a drive letter (`C:\` / `C:/`), a UNC
 * prefix (`\\server`), or any backslash. Detected from the string itself (not
 * `process.platform`) because a bundle's source paths may come from another OS.
 */
function isWindowsStyle(p) {
    return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.includes("\\");
}
/** Basename that understands both `/` and `\` separators, regardless of host OS. */
function pathBasename(p) {
    const parts = p.split(/[\\/]+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : "";
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Drop trailing separators from a root, but never reduce it to empty. */
function stripTrailingSeps(root) {
    const trimmed = root.replace(/[\\/]+$/, "");
    return trimmed || root;
}
/** The native separator a target path should use, by its style. */
function nativeSep(targetRoot) {
    return isWindowsStyle(targetRoot) ? "\\" : "/";
}
/** Re-emit a known native remainder's separators in the target's style. */
function translateRemainder(remainder, sep) {
    return remainder.replace(/[\\/]+/g, (run) => Array.from(run)
        .map(() => sep)
        .join(""));
}
/**
 * Rewrite a SINGLE known native path value (not free-form content): if it sits
 * under `sourceRoot`, relocate it onto `targetRoot` with target-native separators.
 * Exact (no scanning heuristics) so paths with spaces and trailing separators are
 * handled losslessly. Used to compute target cwd / anchor paths.
 */
function rewritePathValue(p, sourceRoot, targetRoot) {
    if (!p || !sourceRoot || sourceRoot === targetRoot)
        return p;
    const src = stripTrailingSeps(sourceRoot);
    const normP = p.replace(/\\/g, "/");
    const normSrc = src.replace(/\\/g, "/");
    let remainder = null;
    if (normP === normSrc)
        remainder = "";
    else if (normP.startsWith(`${normSrc}/`))
        remainder = p.slice(src.length);
    if (remainder === null)
        return p;
    return stripTrailingSeps(targetRoot) + translateRemainder(remainder, nativeSep(targetRoot));
}
// ── Content path rewriting ──
//
// A separator AS IT APPEARS IN CONTENT depends on the escaping of that content:
//  - jsonEscaped (JSONL): one logical separator is the two characters "\\" (an
//    escaped backslash) OR a forward slash. A lone backslash is NEVER a separator
//    there — it always begins a JSON escape (\n, \t, \", \uXXXX) — so it must not
//    be matched, or escapes get corrupted.
//  - raw (Markdown / shell / SQLite values / protobuf leaves): a single "\" or "/".
// The two-backslash alternative is listed first. Both classes EXCLUDE "\" and "/"
// from the segment, which keeps `(?:SEP SEG)*` linear (no catastrophic backtracking).
const SEP_JSON = String.raw `(?:\\\\|/)`;
const SEP_RAW = String.raw `(?:[\\/])`;
const SEGMENT = String.raw `[^"\\/]+`;
// Next position after a root must not be a path-name char (so /Users/al ≠ /Users/alice).
const BOUNDARY = String.raw `(?![^"\s\\/])`;
function sepPattern(jsonEscaped) {
    return jsonEscaped ? SEP_JSON : SEP_RAW;
}
/** Tokenizes a logical separator inside an already-matched tail, for translation. */
function sepToken(jsonEscaped) {
    return jsonEscaped ? /\\\\|\//g : /[\\/]/g;
}
/** Build a regex matching `sourceRoot` (separator-representation tolerant) + its trailing path. */
function buildRootRegex(sourceRoot, jsonEscaped) {
    const SEP = sepPattern(jsonEscaped);
    const tokens = sourceRoot.match(/[\\/]+|[^\\/]+/g) ?? [];
    let rootPat = "";
    tokens.forEach((tok, i) => {
        if (/^[\\/]+$/.test(tok)) {
            rootPat += Array.from(tok)
                .map(() => SEP)
                .join("");
        }
        else if (i === 0 && /^[A-Za-z]:$/.test(tok)) {
            // Drive letter is the only legitimately case-insensitive path component.
            rootPat += `[${tok[0].toUpperCase()}${tok[0].toLowerCase()}]:`;
        }
        else {
            rootPat += escapeRegExp(tok);
        }
    });
    const tail = `(?:${SEP}${SEGMENT})*${SEP}?`;
    return new RegExp(`(${rootPat})${BOUNDARY}(${tail})`, "g");
}
/** The literal separator emitted for the target, by style and escaping mode. */
function emittedSep(targetRoot, jsonEscaped) {
    if (!isWindowsStyle(targetRoot))
        return "/";
    return jsonEscaped ? "\\\\" : "\\";
}
/**
 * Relocate every path rooted at `sourceRoot` onto `targetRoot` inside free-form
 * content, making sessions portable across machines AND operating systems.
 *
 * Each path that begins with `sourceRoot` — matched whether its separators appear
 * as `/`, `\`, or JSON-escaped `\\` — has its root prefix replaced and its
 * remaining separators translated to the target's native separator, re-escaped per
 * `jsonEscaped` so JSONL output stays valid JSON. Only the anchored prefix is
 * relocated; text deeper in a path that coincidentally equals the home string is
 * left in place (you cannot splice a drive root into the middle of a path).
 */
function rewritePaths(content, sourceRoot, targetRoot, options = {}) {
    if (!sourceRoot || !sourceRoot.trim() || sourceRoot === targetRoot)
        return content;
    const jsonEscaped = options.jsonEscaped ?? true;
    const src = stripTrailingSeps(sourceRoot);
    if (!src)
        return content;
    const outSep = emittedSep(targetRoot, jsonEscaped);
    const outRoot = translateRemainder(stripTrailingSeps(targetRoot), outSep);
    const re = buildRootRegex(src, jsonEscaped);
    const token = sepToken(jsonEscaped);
    return content.replace(re, (_match, _root, tail) => outRoot + tail.replace(token, () => outSep));
}
/**
 * Auto-detect the user home directory from a full path. Platform-agnostic: it
 * recognizes the shape of the path string, not the host OS, since a bundle's
 * source path may be from a different machine. Expects a NATIVE single-separator
 * path. Throws when no known home shape matches (callers should prefer explicit
 * overrides and only fall back to this).
 *   C:\\Users\\alice\\foo  → C:\\Users\\alice
 *   D:/Users/alice/foo     → D:/Users/alice
 *   /Users/alice/foo/bar   → /Users/alice
 *   /home/alice/foo/bar    → /home/alice
 *   /root/foo/bar          → /root
 */
function detectHomeDir(fullPath) {
    const winUsers = fullPath.match(/^([A-Za-z]:[\\/]Users[\\/][^\\/]+)/);
    if (winUsers)
        return winUsers[1];
    const macosMatch = fullPath.match(/^(\/Users\/[^/]+)/);
    if (macosMatch)
        return macosMatch[1];
    const linuxMatch = fullPath.match(/^(\/home\/[^/]+)/);
    if (linuxMatch)
        return linuxMatch[1];
    const rootMatch = fullPath.match(/^(\/root)/);
    if (rootMatch)
        return rootMatch[1];
    throw new Error(`could not auto-detect home dir from: ${fullPath}`);
}
/**
 * Like `detectHomeDir`, but falls back to the local home (`os.homedir()`) instead
 * of throwing when the path shape isn't a recognized home — e.g. a project on a
 * Windows drive outside `C:\Users\…` (a CI checkout at `D:\a\…`, a `D:\projects`
 * tree). Used when restoring to the local machine, where the local home is the
 * right default target.
 */
function detectHomeDirSafe(fullPath) {
    try {
        return detectHomeDir(fullPath);
    }
    catch {
        return node_os_1.default.homedir();
    }
}
/**
 * Whether two paths point at the same location. Separator-insensitive (`/` vs `\`)
 * and, on Windows, case-insensitive — so a path recovered as a forward-slash
 * `file://` workspace URI matches the same dir expressed with native backslashes.
 */
function samePath(a, b) {
    const norm = (p) => {
        const s = p.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
        return process.platform === "win32" ? s.toLowerCase() : s;
    };
    return norm(a) === norm(b);
}
