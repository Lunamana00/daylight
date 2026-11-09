import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { change, readDay, readCalendar, monthRange, syncMilestones, listMilestones, day, addDays, widgetPlan, calendarTaskLanes, dailyTaskItems, weekRange, calendarTaskGroups, taskHue } from '../lib/planner-core.ts';

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
const many = { ...input, events: [...input.events, { eventId: 'review', title: 'Review', date: '2026-11-10' }, { eventId: 'draft', title: 'Draft', date: '2026-11-15' }] };
await syncMilestones(db, alice, many);
assert.deepEqual((await listMilestones(db, date, '2026-12-01')).map(e => e.eventId), ['review', 'draft', 'launch'], 'Unarranged milestones default to chronological order');
const arranged = ['launch', 'review', 'draft'].map(eventId => ({ calendarId: input.calendarId, eventId }));
await change(db, bob, { op: 'milestones.reorder', date, order: arranged });
assert.deepEqual((await readDay(db, alice, date)).milestones.map(e => e.eventId), ['launch', 'review', 'draft'], 'A different team member sees the saved order');
await syncMilestones(db, alice, many);
assert.deepEqual((await readDay(db, bob, date)).milestones.map(e => e.eventId), ['launch', 'review', 'draft'], 'Refreshing a calendar snapshot preserves the manual order');
await assert.rejects(change(db, alice, { op: 'milestones.reorder', date, order: arranged.slice(1) }), error => error.status === 409);
await assert.rejects(change(db, alice, { op: 'milestones.reorder', date, order: [arranged[0], arranged[0], arranged[2]] }));
await assert.rejects(change(db, alice, { op: 'milestones.reorder', date, order: [...arranged.slice(0,2), { calendarId: 'unknown', eventId: 'unknown' }] }), error => error.status === 409);
assert.deepEqual((await listMilestones(db, date, '2026-12-01')).map(e => e.eventId), ['launch', 'review', 'draft'], 'Invalid or stale arrangements preserve the saved order');
assert.equal(JSON.stringify((await readDay(db, alice, date)).tasks), originalTasks, 'Reordering milestones never changes daily tasks');
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
assert.deepEqual(monthRange('2028-02-14'), { from: '2028-02-01', to: '2028-02-29' });
assert.deepEqual(monthRange('2100-02-01'), { from: '2100-02-01', to: '2100-02-28' });
assert.deepEqual(monthRange('2026-12-31'), { from: '2026-12-01', to: '2026-12-31' });
assert.throws(() => monthRange('2026-02-30'));
const monthStartTask = await change(db, alice, { op: 'task.add', date: '2026-11-01', title: 'Start of month' });
const monthEndTask = await change(db, alice, { op: 'task.add', date: '2026-11-30', title: 'End of month' });
await change(db, alice, { op: 'task.patch', id: monthEndTask.id, done: true });
await change(db, alice, { op: 'task.add', date: '2026-10-31', title: 'Previous month' });
await change(db, alice, { op: 'task.add', date: '2026-12-01', title: 'Next month' });
await syncMilestones(db, alice, { ...input, calendarId: 'personal@example.test', events: [...input.events, { eventId: 'december', title: 'December event', date: '2026-12-01' }] }, true);
const savedOrder = sqlite.prepare('SELECT * FROM milestone_order ORDER BY calendar_id,event_id').all();
const month = await readCalendar(db, alice, '2026-11-15');
assert.deepEqual(month.tasks.map(task => task.id), [monthStartTask.id, monthEndTask.id], 'Month includes both edges and only the signed-in person’s tasks');
assert.equal(month.tasks[1].done, 1);
assert.deepEqual(month.milestones.map(event => event.calendarId), ['personal@example.test'], 'Other people’s calendars and other months stay out');
assert.deepEqual(sqlite.prepare('SELECT * FROM milestone_order ORDER BY calendar_id,event_id').all(), savedOrder, 'Reading the calendar preserves saved event order');
await change(db, alice, { op: 'task.patch', id: monthStartTask.id, date: '2026-12-01' });
assert.deepEqual((await readCalendar(db, alice, date)).tasks.map(task => task.id), [monthEndTask.id]);
assert.ok((await readCalendar(db, alice, '2026-12-01')).tasks.some(task => task.id === monthStartTask.id));
await change(db, alice, { op: 'task.delete', id: monthEndTask.id });
assert.equal((await readCalendar(db, alice, date)).tasks.length, 0);
console.log('PASS: owner-only edits, personal month visibility, month boundaries and leap years, completion and moved/deleted tasks, calendar/task separation and saved event order.');

const project = await change(db, alice, { op: 'task.add', date: '2030-01-30', endDate: '2030-02-02', title: 'Write paper' });
const first = await change(db, alice, { op: 'subtask.add', taskId: project.id, date: '2030-01-31', title: 'Outline' });
const second = await change(db, alice, { op: 'subtask.add', taskId: project.id, date: '2030-02-01', title: 'Draft' });
assert.equal((await readDay(db, bob, '2030-01-31')).tasks[0].subtasks.length, 2, 'Others can see progress across days');
assert.ok((await readCalendar(db, alice, '2030-02-01')).tasks.some(task => task.id === project.id), 'A period crosses month boundaries');
assert.equal((await readCalendar(db, bob, '2030-02-01')).tasks.length, 0, 'Personal calendar stays owner-only');
assert.equal((await readDay(db, alice, '2030-02-03')).tasks.length, 0, 'Period ends inclusively');
await assert.rejects(change(db, alice, { op: 'task.add', date: '2030-02-02', endDate: '2030-02-01', title: 'Invalid' }));
await assert.rejects(change(db, bob, { op: 'subtask.add', taskId: project.id, date: '2030-01-31', title: 'Intrusion' }), error => error.status === 403);
for (const op of ['subtask.patch', 'subtask.delete']) await assert.rejects(change(db, bob, { op, id: first.id, done: true }), error => error.status === 403);
await assert.rejects(change(db, alice, { op: 'subtask.add', taskId: project.id, date: '2030-02-03', title: 'Outside period' }));
await assert.rejects(change(db, alice, { op: 'task.patch', id: project.id, endDate: '2030-01-31' }), error => error.status === 409);
await assert.rejects(change(db, alice, { op: 'task.patch', id: project.id, done: true }), error => error.status === 409);
await assert.rejects(change(db, alice, { op: 'subtask.patch', id: first.id, done: true }, '2030-02-01'), error => error.status === 409);
await change(db, alice, { op: 'subtask.patch', id: first.id, title: 'Revised outline', date: '2030-02-01' });
assert.equal(widgetPlan(await readDay(db, alice, '2030-01-31')).taskCount, 0, 'Only scheduled subtasks appear in the widget');
await change(db, alice, { op: 'subtask.patch', id: first.id, done: true }, '2030-02-01');
assert.equal((await readDay(db, alice, '2030-02-01')).tasks[0].done, 0);
await change(db, alice, { op: 'subtask.patch', id: second.id, done: true }, '2030-02-01');
assert.equal((await readDay(db, alice, '2030-02-01')).tasks[0].done, 1, 'All subtasks complete the parent');
for (let i = 0; i < 5; i++) await change(db, alice, { op: 'task.add', date: '2030-02-01', title: `Daily ${i}` });
await change(db, bob, { op: 'task.add', date: '2030-02-01', title: 'Another person' });
const widget = widgetPlan(await readDay(db, alice, '2030-02-01'));
assert.equal(widget.tasks.length, 4);
assert.equal(widget.taskCount, 7, 'Widget total includes items outside the four visible rows');
assert.equal(widget.completedCount, 2, 'Completed count includes hidden rows and excludes other people');
await change(db, alice, { op: 'subtask.delete', id: first.id });
assert.equal((await readDay(db, alice, '2030-01-31')).tasks.find(task => task.id === project.id).subtasks.length, 1);
await change(db, alice, { op: 'task.delete', id: project.id });
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM task_subtasks WHERE task_id=?').get(project.id).n, 0, 'Deleting a parent leaves no orphan subtasks');
console.log('PASS: task periods, dated subtasks, owner-only changes, derived progress, widget date guards and complete counts.');
const spans = [
  { id: 'a', date: '2030-01-28', endDate: '2030-01-31' },
  { id: 'b', date: '2030-01-30', endDate: '2030-02-03' },
  { id: 'c', date: '2030-02-01', endDate: '2030-02-02' },
  { id: 'daily', date: '2030-02-01', endDate: null },
];
const laneIds = tasks => calendarTaskLanes(tasks, '2030-01-28', '2030-02-03').map(lane => lane.map(task => task.id));
assert.deepEqual(laneIds(spans), [['a', 'c'], ['b']], 'Overlapping periods keep separate rows and non-overlapping periods reuse a row');
assert.deepEqual(laneIds([...spans].reverse()), laneIds(spans), 'Row placement does not depend on completion ordering');
assert.deepEqual(calendarTaskLanes(spans, '2030-02-01', '2030-02-03').map(lane => lane.map(task => task.id)), [['b'], ['c']], 'A period continues across the month edge');
console.log('PASS: continuous calendar lanes, overlap placement and month edges.');
assert.deepEqual(weekRange('2026-12-01'), { from: '2026-11-30', to: '2026-12-06' });
assert.deepEqual(weekRange('2027-01-01'), { from: '2026-12-28', to: '2027-01-03' });
assert.equal(weekRange('2000-01-01').from, '2000-01-01');
assert.equal(weekRange('2100-12-31').to, '2100-12-31');
const weeklyParent = await change(db, alice, { op: 'task.add', date: '2026-11-29', endDate: '2026-12-02', title: 'Weekly paper' });
const novemberChild = await change(db, alice, { op: 'subtask.add', taskId: weeklyParent.id, date: '2026-11-30', title: 'November outline' });
const decemberChild = await change(db, alice, { op: 'subtask.add', taskId: weeklyParent.id, date: '2026-12-01', title: 'December draft' });
await change(db, bob, { op: 'task.add', date: '2026-12-01', title: 'Private calendar task' });
const weekly = await readCalendar(db, alice, '2026-12-01', 'week');
assert.deepEqual([weekly.from, weekly.to], ['2026-11-30', '2026-12-06']);
assert.ok(weekly.tasks.every(task => task.ownerId === alice.userId), 'Weekly view reads only the signed-in person’s tasks');
assert.ok(weekly.milestones.every(event => event.ownerId === alice.userId), 'Weekly view keeps calendars private');
assert.ok(dailyTaskItems(weekly.tasks, '2026-11-30').some(item => item.id === novemberChild.id && item.parentTitle === 'Weekly paper'));
assert.ok(dailyTaskItems(weekly.tasks, '2026-12-01').some(item => item.id === decemberChild.id));
assert.ok(!dailyTaskItems(weekly.tasks, '2026-12-01').some(item => item.id === novemberChild.id), 'Each child stays on its scheduled date across month boundaries');
console.log('PASS: weekly ranges, private weekly reads, dated subtasks across month and year boundaries.');
const groupBase = weekly.tasks.find(task => task.id === weeklyParent.id);
const sameTitleTasks = [
  { ...groupBase, id: 'group-a', title: 'Same title', subtasks: [
    { id: 'a1', taskId: 'group-a', date: '2026-12-01', title: 'First child', done: 0 },
    { id: 'a2', taskId: 'group-a', date: '2026-12-01', title: 'Second child', done: 1 },
  ] },
  { ...groupBase, id: 'group-b', title: 'Same title', subtasks: [
    { id: 'b1', taskId: 'group-b', date: '2026-12-01', title: 'Other parent', done: 0 },
  ] },
];
const families = calendarTaskGroups(sameTitleTasks, '2026-12-01');
assert.deepEqual(families.map(group => [group.task.id, group.items.map(item => item.id)]), [['group-a', ['a1', 'a2']], ['group-b', ['b1']]], 'Identical parent titles never combine unrelated children');
assert.equal(calendarTaskGroups(sameTitleTasks, '2026-12-02').length, 0, 'Groups contain only children scheduled for the selected day');
assert.equal(taskHue(families[0].task.id), taskHue({ ...sameTitleTasks[0], title: 'Renamed' }.id), 'Task colors survive title changes');
assert.notEqual(taskHue('group-a'), taskHue('group-b'));
console.log('PASS: parent-based calendar groups, scheduled children and stable task colors.');
sqlite.close();
