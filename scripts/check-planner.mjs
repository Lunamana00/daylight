import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { change, readDay, syncMilestones, listMilestones, day, addDays } from '../lib/planner-core.ts';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
const db = {
  prepare(sql) {
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async run() { const result = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(result.changes) } }; },
      async all() { return { results: sqlite.prepare(sql).all(...params) }; },
    };
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const alice = { userId: 'alice', email: 'alice@example.test', fullName: 'Alice' };
const bob = { userId: 'bob', email: 'bob@example.test', fullName: 'Bob' };
const date = '2026-11-05';
for (const bad of ['2026-02-30', '2025-02-29', 'not-a-date', null, '2026-1-1']) assert.throws(() => day(bad));
assert.equal(addDays('2026-12-31', 1), '2027-01-01');
assert.equal(day('2028-02-29'), '2028-02-29');
await readDay(db, bob, date);
const task = await change(db, alice, { op: 'task.add', date, title: 'Read the paper' });
await change(db, bob, { op: 'task.add', date, title: 'Prepare the experiment' });
let team = await readDay(db, bob, date);
assert.equal(team.tasks.length, 2, 'Team members can read each other’s tasks');
assert.equal(team.tasks.find(t => t.id === task.id).ownerName, 'Alice');
for (const op of ['task.patch', 'task.delete']) await assert.rejects(change(db, bob, { op, id: task.id, done: true, ownerId: 'alice' }), error => error.status === 403);
await change(db, alice, { op: 'task.patch', id: task.id, done: true, important: true });
team = await readDay(db, bob, date);
assert.equal(team.tasks.find(t => t.id === task.id).done, 1);
assert.equal(team.tasks.find(t => t.id === task.id).important, 1);
await change(db, alice, { op: 'note.save', date, content: 'Focus on the first draft' });
assert.equal((await readDay(db, bob, date)).notes[0].content, 'Focus on the first draft');
await change(db, alice, { op: 'profile.save', name: 'Alice K' });
assert.equal((await readDay(db, alice, date)).me.name, 'Alice K', 'Login does not reset a chosen display name');
const originalTasks = JSON.stringify((await readDay(db, alice, date)).tasks);
const input = { calendarId: 'team@example.test', name: 'Team milestones', from: date, to: '2026-12-01', events: [{ eventId: 'launch', title: 'Launch', date: '2026-11-20', url: 'https://calendar.google.com/calendar/event?eid=launch' }] };
await syncMilestones(db, alice, input);
await syncMilestones(db, bob, input);
assert.equal((await listMilestones(db, date, '2026-12-01')).length, 1, 'Repeated sync of a shared calendar by another member does not duplicate events');
assert.equal(JSON.stringify((await readDay(db, alice, date)).tasks), originalTasks, 'Calendar sync never changes daily tasks');
await assert.rejects(syncMilestones(db, alice, { ...input, events: [{ eventId: 'bad', title: 'Bad', date: '2026-11-10', url: 'javascript:alert(1)' }] }));
assert.equal((await listMilestones(db, date, '2026-12-01')).length, 1, 'Invalid sync preserves existing milestones');
await assert.rejects(syncMilestones(db, alice, { ...input, events: [...input.events, ...input.events] }));
await syncMilestones(db, bob, { ...input, calendarId: 'other@example.test' });
await syncMilestones(db, alice, { ...input, events: [] });
assert.equal((await listMilestones(db, date, '2026-12-01')).length, 1, 'One member’s sync cannot erase another source');
await change(db, alice, { op: 'task.patch', id: task.id, date: addDays(date, 1), done: false });
assert.equal((await readDay(db, bob, date)).tasks.length, 1);
assert.equal((await readDay(db, bob, addDays(date, 1))).tasks[0].id, task.id);
await change(db, alice, { op: 'task.delete', id: task.id });
assert.equal((await readDay(db, bob, addDays(date, 1))).tasks.length, 0);
await assert.rejects(change(db, alice, { op: 'task.add', date, title: '  ' }));
await assert.rejects(change(db, alice, { op: 'task.patch', id: task.id, done: 'true' }));
console.log('PASS: shared reads, owner-only edits/deletes, daily history, notes, profile persistence, date validation, milestone isolation, atomic validation, sync idempotency, calendar/task separation.');
sqlite.close();
