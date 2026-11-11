import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

Error.stackTraceLimit = 0;
function moduleURL(path, imports = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const [name, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
const core = moduleURL('../lib/planner-core.ts'), types = moduleURL('../lib/work-log-types.ts');
const work = moduleURL('../lib/work-log.ts', { './planner-core': core, './work-log-types': types });
const files = moduleURL('../lib/work-files.ts', { './planner-core': core, './work-log': work });
const { changeWork } = await import(work);
const { uploadWorkFile } = await import(files);
const { githubRepository, connectWorkGithub, saveWorkGithub, disconnectWorkGithub, workGithubState } = await import(moduleURL('../lib/work-github.ts', { './planner-core': core, './work-log': work, './work-files': files, './work-log-types': types }));
const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
const db = {
  prepare(sql) { let args = []; return {
    bind(...values) { args = values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
  }; },
  async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
};
const alice = { userId: 'alice', email: 'alice@example.test' }, bob = { userId: 'bob', email: 'bob@example.test' };
const project = await changeWork(db, alice, { op: 'artifact.add', title: 'Research', stages: ['Report'] });
await changeWork(db, bob, { op: 'artifact.add', title: 'Other', stages: ['Draft'] });
const entry = await changeWork(db, alice, { op: 'entry.add', artifactId: project.id, title: 'Manual result', body: 'Original note', kind: 'result', occurredAt: '2026-11-11T01:00:00Z' });
const pdf = new TextEncoder().encode('%PDF-1.4\nReport fixture\n%%EOF');
await uploadWorkFile(db, alice.userId, entry.id, '보고서 (1).pdf', pdf);
const token = 'github_pat_' + 'x'.repeat(60), secret = 'test-only-encryption-key-'.repeat(3);
const input = { artifactId: project.id, repository: 'Alice/records', token };
const repo = { id: 42, full_name: 'Alice/records', owner: { login: 'Alice' }, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } };
let head = 'initial-commit', tree = 'initial-tree', conflict = false, calls = [];
const actualFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://api.github.com');
  assert.equal(init.headers.Authorization, 'Bearer ' + token);
  assert.equal(init.redirect, 'error');
  const path = parsed.pathname, body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ path, method: init.method, body });
  let result;
  if (path === '/user') result = { login: 'Alice' };
  else if (path === '/repos/Alice/records') result = repo;
  else if (path.endsWith('/branches/main')) result = { commit: { sha: head, commit: { tree: { sha: tree } } } };
  else if (path.endsWith('/git/blobs')) { assert.deepEqual(new Uint8Array(Buffer.from(body.content, 'base64')), pdf); result = { sha: 'pdf-blob' }; }
  else if (path.endsWith('/git/trees')) { assert.equal(body.base_tree, tree); result = { sha: `tree-${calls.length}` }; }
  else if (path.endsWith('/git/commits')) { assert.deepEqual(body.parents, [head]); result = { sha: `commit-${calls.length}` }; }
  else if (path.endsWith('/git/refs/heads/main')) {
    assert.equal(init.method, 'PATCH'); assert.equal(body.force, false);
    if (conflict) return Response.json({ message: 'Conflict' }, { status: 422 });
    head = body.sha; tree = calls.findLast(call => call.path.endsWith('/git/commits')).body.tree; result = { object: { sha: head } };
  } else assert.fail('Unexpected GitHub request: ' + path);
  return Response.json(result);
};
try {
  assert.equal(githubRepository('https://github.com/Alice/records.git/'), 'Alice/records');
  for (const value of ['http://github.com/Alice/records', 'https://github.com.evil.test/Alice/records', 'https://user@github.com/Alice/records', 'https://github.com/Alice/records?token=x', 'Alice/..', 'Alice/records/extra']) assert.throws(() => githubRepository(value));
  await assert.rejects(connectWorkGithub(db, bob.userId, input, secret), error => error.status === 404);
  assert.equal(calls.length, 0, 'Ownership is checked before GitHub access');
  repo.private = false;
  await assert.rejects(connectWorkGithub(db, alice.userId, input, secret), error => error.status === 403);
  repo.private = true; repo.owner.login = 'Other';
  await assert.rejects(connectWorkGithub(db, alice.userId, input, secret), error => error.status === 403);
  repo.owner.login = 'Alice';
  await connectWorkGithub(db, alice.userId, input, secret);
  assert.ok(!sqlite.prepare('SELECT token_cipher FROM work_github_connections').get().token_cipher.includes(token));
  assert.ok(!JSON.stringify(await workGithubState(db, alice.userId, project.id)).includes(token));
  await assert.rejects(saveWorkGithub(db, bob.userId, entry.id, secret), error => error.status === 404);
  await assert.rejects(saveWorkGithub(db, alice.userId, entry.id, 'different-key'.repeat(4)), error => error.status === 403);
  const first = await saveWorkGithub(db, alice.userId, entry.id, secret);
  const savedTree = calls.findLast(call => call.path.endsWith('/git/trees')).body.tree;
  assert.equal(savedTree.length, 3, 'One commit includes Markdown, JSON, and file bytes');
  const markdown = savedTree.find(item => item.path.endsWith('/README.md')).content;
  assert.match(markdown, /Original note/); assert.match(markdown, /\.\/files\//);
  assert.ok(!markdown.includes('/api/worklog/files/'), 'GitHub attachments do not depend on daylight login');
  const json = savedTree.find(item => item.path.endsWith('/record.json')).content;
  assert.ok(!json.includes(token) && !json.includes(secret) && !json.includes(alice.email));
  const commits = calls.filter(call => call.path.endsWith('/git/commits')).length;
  assert.equal((await saveWorkGithub(db, alice.userId, entry.id, secret)).unchanged, true);
  assert.equal(calls.filter(call => call.path.endsWith('/git/commits')).length, commits, 'An unchanged save creates no commit');
  await changeWork(db, alice, { op: 'entry.patch', id: entry.id, body: 'Revised note' });
  const second = await saveWorkGithub(db, alice.userId, entry.id, secret);
  assert.notEqual(first.version.path, second.version.path);
  assert.equal((await workGithubState(db, alice.userId, project.id)).versions.length, 2);
  await changeWork(db, alice, { op: 'entry.patch', id: entry.id, body: 'Unsaved revision' });
  conflict = true;
  await assert.rejects(saveWorkGithub(db, alice.userId, entry.id, secret), error => error.status === 409);
  assert.equal((await workGithubState(db, alice.userId, project.id)).versions.length, 2, 'A rejected push does not claim a saved version');
  assert.equal(sqlite.prepare('SELECT body FROM work_entries WHERE id=?').get(entry.id).body, 'Unsaved revision');
  conflict = false; repo.private = false; calls = [];
  await assert.rejects(saveWorkGithub(db, alice.userId, entry.id, secret), error => error.status === 403);
  assert.equal(calls.length, 1, 'A now-public repository receives no files');
  repo.private = true;
  sqlite.prepare("UPDATE work_entries SET provider='codex' WHERE id=?").run(entry.id);
  await assert.rejects(saveWorkGithub(db, alice.userId, entry.id, secret), /직접 작성/);
  sqlite.prepare("UPDATE work_entries SET provider='manual' WHERE id=?").run(entry.id);
  await disconnectWorkGithub(db, alice.userId, project.id);
  const state = await workGithubState(db, alice.userId, project.id);
  assert.equal(state.connection, null); assert.equal(state.versions.length, 2);
  await assert.rejects(saveWorkGithub(db, alice.userId, entry.id, secret), error => error.status === 409);
  console.log('GitHub manual record checks passed: private access, encrypted connection, complete versions, retries, conflicts, and disconnect.');
} finally { globalThis.fetch = actualFetch; sqlite.close(); }
