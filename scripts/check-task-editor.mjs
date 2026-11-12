import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { change, dailyTaskItems, readTaskCatalog, readBacklog, readDay, widgetPlan } from '../lib/planner-core.ts';

Error.stackTraceLimit = 0;

function moduleURL(path, imports = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const name of ['react', 'react/jsx-runtime', 'lucide-react']) code = code.replaceAll(JSON.stringify(name), JSON.stringify(import.meta.resolve(name)));
  for (const [name, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
const coreURL = new URL('../lib/planner-core.ts', import.meta.url).href;
const backlogURL = moduleURL('../components/planner-backlog.tsx', { '../lib/planner-core': coreURL });
const { PlannerTask, PlannerDailySubtask } = await import(moduleURL('../components/planner-task.tsx', { '../lib/planner-core': coreURL, './planner-backlog': backlogURL }));
const { changeWork, readWorkCatalog, readWorkDetail } = await import(moduleURL('../lib/work-log.ts', { './planner-core': coreURL, './work-log-types': moduleURL('../lib/work-log-types.ts') }));
const task = {
  id: 'period', ownerId: 'alice', title: '강화학습 논문 발표', date: '2026-11-11', endDate: '2026-11-20',
  done: 0, important: 0, subtasks: [], projectId: null, projectHue: null,
};
const props = {
  task, projects: [], date: task.date, busy: false, readOnly: false, draggedTask: null,
  onChange: async () => true, onDelete() {}, onDragStart() {}, onDragEnd() {},
};
const render = extra => renderToStaticMarkup(createElement(PlannerTask, { ...props, ...extra }));
const editor = render({ initialEditing: true, reorderable: false });
assert.match(editor, /aria-label="할 일 제목"/);
assert.match(editor, /value="강화학습 논문 발표"/);
assert.match(editor, /value="2026-11-11"/);
assert.match(editor, /value="2026-11-20"/);
assert.match(editor, />저장<\/button>/);
assert.match(editor, /＋ 하위 할 일/);
assert.doesNotMatch(render({}), /aria-label="할 일 제목"/, 'Normal task rows do not open in edit mode');
assert.doesNotMatch(render({ initialEditing: true, readOnly: true }), /aria-label="할 일 제목"/, 'Read-only tasks cannot open the editor');
assert.deepEqual(dailyTaskItems([task], task.date), [], 'A period without subtasks stays out of the daily list');
console.log('Period editor checks passed: direct editing, original dates, subtasks, read-only access, and daily list exclusion.');

const plannerSource = ts.createSourceFile('planner.tsx', readFileSync(new URL('../app/planner.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let shortcut;
function findComposer(node) {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(plannerSource) === 'form' && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(plannerSource) === 'className' && attr.initializer?.text === 'task-composer')) {
    shortcut = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(plannerSource) === 'onKeyDown')?.initializer?.expression?.getText(plannerSource);
  }
  ts.forEachChild(node, findComposer);
}
findComposer(plannerSource);
assert.ok(shortcut, 'The task form has a keyboard shortcut');
const handleShortcut = new Function('busy', 'draft', `return (${shortcut});`);
for (const test of [
  { name: 'Command Enter', submitted: 1, prevented: 1 },
  { name: 'Plain Enter keeps a newline', event: { metaKey: false }, submitted: 0, prevented: 0 },
  { name: 'Another key', event: { key: 'a' }, submitted: 0, prevented: 0 },
  { name: 'Korean composition', nativeEvent: { isComposing: true }, submitted: 0, prevented: 0 },
  { name: 'Composition end key', nativeEvent: { keyCode: 229 }, submitted: 0, prevented: 0 },
  { name: 'Held key', event: { repeat: true }, submitted: 0, prevented: 1 },
  { name: 'Saving', busy: true, submitted: 0, prevented: 1 },
  { name: 'Empty title', draft: '  ', submitted: 0, prevented: 1 },
]) {
  let submitted = 0, prevented = 0;
  handleShortcut(test.busy ?? false, test.draft ?? '새 할 일')({
    key: 'Enter', metaKey: true, repeat: false, ...test.event,
    nativeEvent: { isComposing: false, keyCode: 13, ...test.nativeEvent },
    preventDefault() { prevented++; }, currentTarget: { requestSubmit() { submitted++; } },
  });
  assert.deepEqual([submitted, prevented], [test.submitted, test.prevented], test.name);
}
console.log('Task shortcut checks passed: Command Enter, newlines, Korean composition, held keys, and submission guards.');

const taskSource = ts.createSourceFile('planner-task.tsx', readFileSync(new URL('../components/planner-task.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let scheduleChange;
function findScheduleControl(node) {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(taskSource) === 'select' && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(taskSource) === 'aria-label' && attr.initializer?.text === '하위 할 일 일정')) {
    scheduleChange = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(taskSource) === 'onChange')?.initializer?.expression?.getText(taskSource);
  }
  ts.forEachChild(node, findScheduleControl);
}
findScheduleControl(taskSource);
assert.ok(scheduleChange, 'Long-task subtasks have an explicit undated option');
const selectSchedule = new Function('setChildDate', 'task', 'date', `return (${scheduleChange});`);
for (const [value, currentDate, expected] of [
  ['unscheduled', '2026-11-12', ''], ['scheduled', '2026-11-12', '2026-11-12'],
  ['scheduled', '2026-11-01', task.date], ['scheduled', '2026-12-01', task.endDate],
]) {
  let selectedDate;
  selectSchedule(value => { selectedDate = value; }, task, currentDate)({ target: { value } });
  assert.equal(selectedDate, expected, 'Scheduling is optional and stays inside the parent period');
}

const grouped = render({ grouped: true });
assert.doesNotMatch(grouped, /aria-label="강화학습 논문 발표 완료"/, 'Long work is a group, not a daily completion checkbox');
assert.match(grouped, /task-title-edit/);
assert.match(grouped, /＋ 하위 할 일/);
assert.doesNotMatch(grouped, /<details class="subtasks"/, 'An empty subtask list has no collapse control');
const children = [
  { id: 'today-child', taskId: task.id, title: '오늘의 하위 할 일', date: task.date, done: 0, sortOrder: 0 },
  { id: 'later-child', taskId: task.id, title: '다른 날짜의 하위 할 일', date: '2026-11-12', done: 0, sortOrder: 1 },
];
const parent = { ...task, subtasks: children, projectTitle: '연구 프로젝트', projectId: 'project' };
const undatedChild = { id: 'undated-child', title: '날짜 미정 세부 작업', taskId: task.id, taskTitle: task.title, taskDate: task.date, taskEndDate: task.endDate, projectId: null, projectTitle: null, projectHue: null };
const parentWithUndated = render({ task: { ...task, unscheduledCount: 1 }, grouped: true, backlog: [undatedChild], onDeleteBacklog() {} });
assert.match(parentWithUndated, /날짜 미정 세부 작업/, 'An undated detail stays visible under its long-task parent');
assert.match(parentWithUndated, /aria-label="날짜 미정 세부 작업 날짜 지정"/);
assert.match(render({ task: parent, grouped: true }), /<details class="subtasks"[\s\S]*＋ 하위 할 일<\/button><\/details>/, 'The add control stays inside a non-empty collapsible list');
const childRow = renderToStaticMarkup(createElement(PlannerDailySubtask, { ...props, task: parent, child: children[0], onOpenTask() {} }));
assert.match(childRow, /오늘의 하위 할 일/);
assert.match(childRow, /강화학습 논문 발표/);
assert.match(childRow, /연구 프로젝트/);
assert.doesNotMatch(childRow, /다른 날짜의 하위 할 일/, 'The daily row contains only the selected execution item');
assert.doesNotMatch(childRow, />0<\/button>/, 'An unchecked checkbox does not render the numeric false value');
assert.match(render({ task: parent, initialChildId: 'today-child' }), /aria-label="하위 할 일 제목" value="오늘의 하위 할 일"/, 'A daily child opens directly in edit mode');
assert.match(render({ task: { ...task, endDate: null }, showDate: true }), /<time class="task-period" dateTime="2026-11-11">/, 'The full list identifies a one-day task date');

const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
const db = { prepare(sql) { let args = []; return {
  bind(...values) { args = values; return this; },
  async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
}; }, async batch(statements) {
  sqlite.exec('BEGIN');
  try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
} };
const owner = { userId: 'layout-owner', email: 'owner@example.test' }, other = { userId: 'layout-other', email: 'other@example.test' };
await change(db, other, { op: 'task.add', date: '2041-01-01', title: 'Other person' });
const old = await change(db, owner, { op: 'task.add', date: '2020-01-01', title: 'Earlier work' });
await change(db, owner, { op: 'task.patch', id: old.id, done: true });
const future = await change(db, owner, { op: 'task.add', date: '2041-01-01', endDate: '2041-01-15', title: 'Future work' });
await change(db, owner, { op: 'subtask.add', taskId: future.id, date: '2041-01-02', title: 'Future child' });
const catalog = await readTaskCatalog(db, owner);
assert.deepEqual(catalog.map(item => item.id), [future.id, old.id], 'All dates are included and completed work stays at the bottom');
assert.ok(catalog.every(item => item.ownerId === owner.userId), 'The catalog never includes another person’s work');
assert.equal(catalog[0].subtasks[0].title, 'Future child');
assert.equal(dailyTaskItems(catalog, '2041-01-01').length, 0);
assert.deepEqual(dailyTaskItems(catalog, '2041-01-02').map(item => item.title), ['Future child']);

const waiting = await change(db, owner, { op: 'backlog.add', taskId: future.id, title: 'Unscheduled child' });
await assert.rejects(change(db, other, { op: 'backlog.add', taskId: future.id, title: 'Intrusion' }), error => error.status === 403);
assert.deepEqual(await readBacklog(db, other), [], 'Undated items are private');
await assert.rejects(change(db, other, { op: 'backlog.patch', id: waiting.id, title: 'Intrusion' }), error => error.status === 404);
await change(db, owner, { op: 'subtask.patch', id: catalog[0].subtasks[0].id, done: true });
const waitingCatalog = await readTaskCatalog(db, owner);
assert.equal(waitingCatalog.find(item => item.id === future.id).done, 0, 'Undated work prevents a parent from being marked complete');
assert.equal(waitingCatalog.find(item => item.id === future.id).unscheduledCount, 1);
assert.equal(widgetPlan(await readDay(db, owner, '2041-01-01', true)).taskCount, 0, 'Undated work is not a daily or widget item');
await assert.rejects(change(db, owner, { op: 'backlog.schedule', id: waiting.id, date: '2041-02-01' }), error => error.status === 409);
assert.equal((await readBacklog(db, owner)).length, 1, 'An invalid date keeps the item in the backlog');
await change(db, owner, { op: 'backlog.schedule', id: waiting.id, date: '2041-01-03' });
assert.equal((await readBacklog(db, owner)).length, 0);
assert.equal(dailyTaskItems(await readTaskCatalog(db, owner), '2041-01-03')[0].id, waiting.id, 'Scheduling keeps identity and creates the dated child');
await assert.rejects(change(db, owner, { op: 'backlog.schedule', id: waiting.id, date: '2041-01-03' }), error => error.status === 409);

const project = await changeWork(db, owner, { op: 'artifact.add', title: 'Delete fixture', stages: ['Draft'] });
const loose = await change(db, owner, { op: 'backlog.add', projectId: project.id, title: 'Loose work' });
await change(db, owner, { op: 'backlog.patch', id: loose.id, title: 'Saved loose work' });
await change(db, owner, { op: 'backlog.schedule', id: loose.id, date: '2041-01-04' });
const scheduled = (await readTaskCatalog(db, owner)).find(item => item.id === loose.id);
assert.equal(scheduled.title, 'Saved loose work'); assert.equal(scheduled.projectId, project.id, 'Scheduling retains the project');
const remaining = await change(db, owner, { op: 'backlog.add', projectId: project.id, title: 'Keep undated work' });
const record = await changeWork(db, owner, { op: 'entry.add', artifactId: project.id, taskId: loose.id, kind: 'result', title: 'Keep record', body: 'Keep this report.', occurredAt: '2041-01-04T00:00:00Z' });
sqlite.prepare("INSERT INTO work_files (id,owner_id,entry_id,object_key,checksum,file_name,content_type,size,created_at) VALUES ('file',?,?,'fixture','checksum','report.pdf','application/pdf',1,'2041-01-04')").run(owner.userId, record.id);
sqlite.exec("INSERT INTO work_file_chunks VALUES ('file',0,x'01')");
sqlite.prepare("INSERT INTO work_github_versions (id,owner_id,entry_id,repository_id,repository,commit_sha,path,digest,saved_at) VALUES ('version',?,?,1,'owner/records','sha','report.md','digest','2041-01-04')").run(owner.userId, record.id);
await assert.rejects(changeWork(db, other, { op: 'artifact.delete', id: project.id }), error => error.status === 404);
const taskRows = sqlite.prepare('SELECT * FROM tasks ORDER BY id').all();
await changeWork(db, owner, { op: 'artifact.delete', id: project.id });
assert.deepEqual(sqlite.prepare('SELECT * FROM tasks ORDER BY id').all(), taskRows, 'Deleting a project keeps its tasks');
assert.equal((await readWorkCatalog(db, owner)).artifacts.length, 0);
const pending = await readWorkDetail(db, owner.userId, null);
assert.equal(pending.entries[0].id, record.id); assert.equal(pending.entries[0].body, 'Keep this report.');
assert.equal(pending.entries[0].files[0].id, 'file');
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM work_file_chunks').get().n, 1);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM work_github_versions').get().n, 1);
assert.equal((await readBacklog(db, owner)).find(item => item.id === remaining.id).projectId, null, 'Project deletion keeps and unlinks undated work');
await change(db, owner, { op: 'backlog.delete', id: remaining.id });
assert.equal((await readBacklog(db, owner)).length, 0);
sqlite.close();
console.log('Task checks passed: collapse controls, private undated work, date assignment, project deletion with records/files preserved, and completed ordering.');
