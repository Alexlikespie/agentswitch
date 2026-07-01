"use strict";
/**
 * Thin, purpose-built wrapper over Node's built-in `node:sqlite`.
 *
 * Why a wrapper: (1) suppress the one-time "SQLite is an experimental feature"
 * warning so it never leaks into CLI output; (2) normalise BLOB columns to
 * Buffers (node:sqlite returns them as plain Uint8Array); (3) expose dynamic
 * column introspection, which the Codex restore relies on because Codex's
 * `state_5.sqlite` schema can change between versions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDb = openDb;
// node:sqlite emits an ExperimentalWarning the moment the module is first loaded.
// Patch process.emitWarning to drop just that warning BEFORE loading the module,
// without touching any other process warning.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning, ...rest) => {
    const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
    const text = typeof warning === "string" ? warning : warning?.message || "";
    if (type === "ExperimentalWarning" && /SQLite/i.test(text))
        return;
    originalEmitWarning(warning, ...rest);
});
// Load via process.getBuiltinModule (Node 22.3+) rather than a static import: it's
// opaque to bundlers (Vite/esbuild can't statically resolve `node:sqlite` because
// it's missing from their builtin-modules list) and works under both CJS and the
// test runner.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;
/** Convert node:sqlite's Uint8Array BLOBs to Buffers; leave everything else as-is. */
function normaliseRow(row) {
    for (const key of Object.keys(row)) {
        const value = row[key];
        if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
            row[key] = Buffer.from(value);
        }
    }
    return row;
}
function openDb(filePath, opts) {
    const db = new DatabaseSync(filePath, { readOnly: opts?.readOnly ?? false });
    return {
        all(sql, ...params) {
            const rows = db.prepare(sql).all(...params);
            return rows.map((r) => normaliseRow(r));
        },
        get(sql, ...params) {
            const row = db.prepare(sql).get(...params);
            return row ? normaliseRow(row) : undefined;
        },
        run(sql, ...params) {
            db.prepare(sql).run(...params);
        },
        exec(sql) {
            db.exec(sql);
        },
        columns(table) {
            if (!SAFE_IDENTIFIER.test(table)) {
                throw new Error(`Unsafe SQLite table identifier: ${table}`);
            }
            const rows = db.prepare(`pragma table_info(${table})`).all();
            return rows.map((r) => r.name);
        },
        close() {
            db.close();
        },
    };
}
