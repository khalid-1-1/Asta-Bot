/**
 * dashboard/backup.selftest.mjs
 * -----------------------------------------------------------------------
 * NOT part of the shipped bot. Stage 9, item #10 (Backup Verification) /
 * item #19 (Testing) - exercises dashboard/lib/backup.js's checksum
 * logic for real against a temp directory (monkey-patches its DATA_DIR
 * indirectly by running inside an isolated CWD copy), rather than only
 * reviewing the diff by eye.
 *
 * Run with: node dashboard/backup.selftest.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// backup.js resolves its data dir relative to its own file location
// (dashboard/data/backups), so we test against a temporary copy of the
// dashboard/lib tree instead of the real one - this must never write
// into the actual shipped dashboard/data directory.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage9-backup-test-'));
const tmpLib = path.join(tmpRoot, 'dashboard', 'lib');
fs.mkdirSync(tmpLib, { recursive: true });
for (const f of ['backup.js', 'settings-store.js', 'scheduler.js']) {
    fs.copyFileSync(path.join(__dirname, 'lib', f), path.join(tmpLib, f));
}
// settings-store.js / scheduler.js also resolve their own data dirs
// relative to __dirname the same way, so copying all three together
// keeps every read/write inside tmpRoot.

const backup = await import(path.join(tmpLib, 'backup.js'));

let passed = 0, failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`PASS - ${name}`); passed++; }
    catch (e) { console.log(`FAIL - ${name}: ${e?.message || e}`); failed++; }
}

const mockContext = {
    exportPluginState: () => ({ menu: { enabled: true } }),
    getStats: () => ({ totalCommands: 3 }),
    importPluginState: () => {},
};

await test('createBackup succeeds and is listed as verified', async () => {
    const res = backup.createBackup(mockContext, 'test-backup');
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    const list = backup.listBackups();
    const entry = list.find(b => b.id === res.manifest.id);
    assert.ok(entry, 'backup not found in listing');
    assert.strictEqual(entry.verified, true);
});

await test('a tampered backup file is detected as unverified and listed as such', async () => {
    const res = backup.createBackup(mockContext, 'tamper-me');
    const filePath = path.join(tmpRoot, 'dashboard', 'data', 'backups', `${res.manifest.id}.json`);
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    payload.dashboardSettings.tampered = true; // mutate content without recomputing checksum
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

    const list = backup.listBackups();
    const entry = list.find(b => b.id === res.manifest.id);
    assert.ok(entry, 'tampered backup should still be listed');
    assert.strictEqual(entry.verified, false, 'tampered backup must be reported as unverified');
});

await test('restoreBackup refuses a tampered/corrupted backup', async () => {
    const res = backup.createBackup(mockContext, 'tamper-restore');
    const filePath = path.join(tmpRoot, 'dashboard', 'data', 'backups', `${res.manifest.id}.json`);
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    payload.name = 'renamed-after-the-fact';
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

    const restoreResult = backup.restoreBackup(res.manifest.id, mockContext);
    assert.strictEqual(restoreResult.ok, false);
    assert.strictEqual(restoreResult.reason, 'invalid_backup_structure');
});

await test('restoreBackup succeeds for a genuine, untouched backup', async () => {
    const res = backup.createBackup(mockContext, 'genuine');
    const restoreResult = backup.restoreBackup(res.manifest.id, mockContext);
    assert.strictEqual(restoreResult.ok, true, JSON.stringify(restoreResult));
    assert.ok(restoreResult.safetyBackupId, 'restore should have taken a pre-restore safety backup');
});

console.log(`\n${passed} passed, ${failed} failed`);
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
if (failed > 0) process.exit(1);
