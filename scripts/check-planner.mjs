import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { change, readDay, readCalendar, monthRange, syncMilestones, listMilestones, day, addDays, widgetPlan, calendarTaskLanes, calendarWeekLayout, calendarWeekOffsets, dailyTaskItems, weekRange, calendarTaskGroups, taskHue } from '../lib/planner-core.ts';

const previous = new DatabaseSync(':memory:');
const migrations = readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort();
for (const file of migrations.filter(name => name < '0008_task_order.sql')) previous.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
previous.exec(`INSERT INTO members VALUES ('migration-owner','Owner','owner@example.test','2040-01-01');
  INSERT INTO tasks (id,owner_id,date,title,done,created_at,updated_at) VALUES
    ('older','migration-owner','2040-01-02','Keep completed task',1,'2040-01-01','2040-01-01'),
    ('newer','migration-owner','2040-01-01','Keep parent',0,'2040-01-02','2040-01-02');
  INSERT INTO task_subtasks (id,task_id,date,title,created_at,updated_at) VALUES
    ('later-child','newer','2040-01-02','Later date','2040-01-01','2040-01-01'),
    ('earlier-child','newer','2040-01-01','Earlier date','2040-01-02','2040-01-02');`);
const savedTasks = previous.prepare('SELECT id,title,date,done FROM tasks ORDER BY id').all();
previous.exec(readFileSync(new URL('../drizzle/0008_task_order.sql', import.meta.url), 'utf8'));
assert.deepEqual(previous.prepare('SELECT id,title,date,done FROM tasks ORDER BY id').all(), savedTasks, 'Order migration preserves existing task data');
assert.deepEqual(previous.prepare('SELECT id FROM tasks ORDER BY sort_order').all().map(row => row.id), ['older', 'newer']);
assert.deepEqual(previous.prepare('SELECT id FROM task_subtasks ORDER BY sort_order').all().map(row => row.id), ['earlier-child', 'later-child'], 'Order migration retains the previous dated subtask order');
previous.close();

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
for (let i = 0; i < 5; i++) {
  const daily = await change(db, alice, { op: 'task.add', date: '2030-02-01', title: `Daily ${i}` });
  if (i === 4) await change(db, alice, { op: 'task.patch', id: daily.id, done: true });
}
await change(db, bob, { op: 'task.add', date: '2030-02-01', title: 'Another person' });
const widget = widgetPlan(await readDay(db, alice, '2030-02-01'));
assert.equal(widget.tasks.length, 4);
assert.equal(widget.taskCount, 7, 'Widget total includes items outside the four visible rows');
assert.equal(widget.completedCount, 3, 'Completed count includes hidden rows and excludes other people');
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
assert.deepEqual(laneIds(spans), [['a'], ['b'], ['c']], 'Overlapping periods follow the saved task order');
assert.deepEqual(laneIds([...spans].reverse()), [['c'], ['b'], ['a']], 'Reordered periods keep their order in the month view');
assert.deepEqual(laneIds([spans[0], spans[2]]), [['a', 'c']], 'Non-overlapping periods reuse a row');
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
const orderedDate = '2040-06-04';
const orderOne = await change(db, alice, { op: 'task.add', date: orderedDate, title: 'First single task' });
const orderTwo = await change(db, alice, { op: 'task.add', date: orderedDate, title: 'Second single task' });
const orderThree = await change(db, alice, { op: 'task.add', date: orderedDate, endDate: '2040-06-10', title: 'Third task with children' });
const orderChild = await change(db, alice, { op: 'subtask.add', taskId: orderThree.id, date: orderedDate, title: 'Third task child' });
const expectedOrder = [orderOne.id, orderTwo.id, orderThree.id];
assert.deepEqual((await readDay(db, alice, orderedDate)).tasks.map(task => task.id), expectedOrder);
await change(db, alice, { op: 'task.patch', id: orderOne.id, done: true });
await change(db, alice, { op: 'task.patch', id: orderTwo.id, important: true });
await change(db, alice, { op: 'subtask.patch', id: orderChild.id, done: true });
const completedLast = [orderTwo.id, orderOne.id, orderThree.id];
assert.deepEqual((await readDay(db, alice, orderedDate)).tasks.map(task => task.id), completedLast, 'Completed tasks and completed parents go to the bottom');
assert.deepEqual((await readCalendar(db, alice, orderedDate, 'week')).tasks.map(task => task.id), completedLast, 'Weekly calendar uses the same order for single and multi-day tasks');
await change(db, alice, { op: 'task.patch', id: orderTwo.id, date: '2040-06-05' });
assert.deepEqual((await readCalendar(db, alice, '2040-06-05', 'week')).tasks.map(task => task.id), completedLast, 'Changing a date preserves the stored task order');
assert.deepEqual(dailyTaskItems(sameTitleTasks, '2026-12-01').map(item => item.id), ['a1', 'b1', 'a2'], 'Completed daily items go below all unfinished items');
await change(db, alice, { op: 'task.patch', id: orderOne.id, done: false });
await change(db, alice, { op: 'subtask.patch', id: orderChild.id, done: false });
await change(db, alice, { op: 'task.patch', id: orderTwo.id, date: orderedDate });
assert.deepEqual((await readDay(db, alice, orderedDate)).tasks.map(task => task.id), expectedOrder, 'Undo completion restores the saved position');
await change(db, alice, { op: 'task.move', id: orderThree.id, targetId: orderOne.id, date: orderedDate });
const movedOrder = [orderThree.id, orderOne.id, orderTwo.id];
assert.deepEqual((await readDay(db, alice, orderedDate)).tasks.map(task => task.id), movedOrder, 'Move inserts the parent at the requested position');
assert.deepEqual((await readCalendar(db, alice, orderedDate, 'week')).tasks.map(task => task.id), movedOrder, 'Manual order persists in calendar reads');
const orderFour = await change(db, alice, { op: 'task.add', date: orderedDate, title: 'New task at end' });
assert.deepEqual((await readDay(db, alice, orderedDate)).tasks.map(task => task.id), [...movedOrder, orderFour.id]);
const secondChild = await change(db, alice, { op: 'subtask.add', taskId: orderThree.id, date: orderedDate, title: 'Second child' });
await change(db, alice, { op: 'subtask.move', id: secondChild.id, targetId: orderChild.id, date: orderedDate });
const readChildren = async () => (await readDay(db, alice, orderedDate)).tasks.find(task => task.id === orderThree.id).subtasks.map(child => child.id);
assert.deepEqual(await readChildren(), [secondChild.id, orderChild.id]);
await change(db, alice, { op: 'subtask.patch', id: secondChild.id, done: true });
assert.deepEqual(await readChildren(), [orderChild.id, secondChild.id], 'Completed subtasks move to the bottom within their parent');
await assert.rejects(change(db, alice, { op: 'subtask.move', id: secondChild.id, targetId: orderChild.id, date: orderedDate }), error => error.status === 409);
await change(db, alice, { op: 'subtask.patch', id: secondChild.id, done: false });
assert.deepEqual(await readChildren(), [secondChild.id, orderChild.id], 'Undo subtask completion restores its manual order');
const foreignTask = await change(db, bob, { op: 'task.add', date: orderedDate, title: 'Private write permission' });
for (const [id, targetId] of [[orderOne.id, foreignTask.id], [foreignTask.id, orderOne.id]]) {
  await assert.rejects(change(db, alice, { op: 'task.move', id, targetId, date: orderedDate }), error => error.status === 403);
}
const otherChild = await change(db, alice, { op: 'subtask.add', taskId: orderFour.id, date: orderedDate, title: 'Other parent child' });
await assert.rejects(change(db, alice, { op: 'subtask.move', id: secondChild.id, targetId: otherChild.id, date: orderedDate }), error => error.status === 403);
await change(db, alice, { op: 'task.patch', id: orderOne.id, done: true });
await assert.rejects(change(db, alice, { op: 'task.move', id: orderOne.id, targetId: orderTwo.id, date: orderedDate }), error => error.status === 409);
await change(db, alice, { op: 'subtask.patch', id: secondChild.id, done: true });
const orderedWidget = widgetPlan(await readDay(db, alice, orderedDate));
assert.deepEqual(orderedWidget.tasks.map(item => item.id), [orderChild.id, orderTwo.id, otherChild.id, secondChild.id], 'Widget fills unfinished rows before completed children');
assert.equal(orderedWidget.taskCount, 5);
assert.equal(orderedWidget.completedCount, 2);
console.log('PASS: saved task and subtask order, completion sorting, undo, calendar/widget order and owner-only moves.');
const weekPositions = tasks => calendarWeekLayout(tasks, '2026-11-09', '2026-11-15').map(({ task, column, span, row }) => [task.id, column, span, row]);
assert.deepEqual(weekPositions([
  { id: 'mon-first', date: '2026-11-09', endDate: null },
  { id: 'mon-second', date: '2026-11-09', endDate: null },
  { id: 'tue-first', date: '2026-11-10', endDate: null },
  { id: 'family', date: '2026-11-09', endDate: '2026-11-10' },
  { id: 'wed-first', date: '2026-11-11', endDate: null },
  { id: 'tue-last', date: '2026-11-10', endDate: null },
  { id: 'next-week', date: '2026-11-16', endDate: null },
]), [
  ['mon-first', 1, 1, 1], ['mon-second', 1, 1, 2], ['tue-first', 2, 1, 1],
  ['family', 1, 2, 3], ['wed-first', 3, 1, 1], ['tue-last', 2, 1, 4],
], 'Each day starts at the top while overlapping tasks keep their existing order');
assert.deepEqual(weekPositions([
  { id: 'from-previous-week', date: '2026-11-08', endDate: '2026-11-09' },
  { id: 'into-next-week', date: '2026-11-12', endDate: '2026-11-17' },
]), [['from-previous-week', 1, 1, 1], ['into-next-week', 4, 4, 1]], 'Period cards clip to the week and reuse unoccupied days');
console.log('PASS: independent weekly task columns, preserved overlapping order and clipped period cards.');
assert.deepEqual(calendarWeekOffsets([
  { column: 1, span: 1, height: 84 }, { column: 3, span: 1, height: 66 },
  { column: 1, span: 1, height: 66 }, { column: 3, span: 1, height: 66 },
  { column: 1, span: 2, height: 100 }, { column: 2, span: 1, height: 40 },
  { column: 3, span: 1, height: 40 },
]), [0, 0, 92, 74, 166, 274, 148], 'Different card heights pack independently while spanning cards preserve order');
assert.deepEqual(calendarWeekOffsets([]), []);
sqlite.close();
