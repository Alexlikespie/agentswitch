"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256File = sha256File;
exports.countFiles = countFiles;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** Stream a file through SHA-256 and return the hex digest. */
function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = node_crypto_1.default.createHash("sha256");
        const stream = node_fs_1.default.createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
}
/** Recursively count files under `dir` whose name ends with `ext` ("" counts all). */
function countFiles(dir, ext) {
    let count = 0;
    for (const entry of node_fs_1.default.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            count += countFiles(node_path_1.default.join(dir, entry.name), ext);
        }
        else if (entry.name.endsWith(ext)) {
            count++;
        }
    }
    return count;
}
