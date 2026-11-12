import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { change, dailyTaskItems, readTaskCatalog, readBacklog, readDay, widgetPlan, widgetWeekPlan } from '../lib/planner-core.ts';

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
const { PlannerBacklogRow } = await import(backlogURL);
const sortableURL = moduleURL('../components/planner-sortable-list.tsx');
const { PlannerSortableList } = await import(sortableURL);
const { PlannerTask, PlannerDailySubtask } = await import(moduleURL('../components/planner-task.tsx', { '../lib/planner-core': coreURL, './planner-backlog': backlogURL, './planner-sortable-list': sortableURL }));
const { changeWork, readWorkCatalog, readWorkDetail } = await import(moduleURL('../lib/work-log.ts', { './planner-core': coreURL, './work-log-types': moduleURL('../lib/work-log-types.ts') }));
const task = {
  id: 'period', ownerId: 'alice', title: '강화학습 논문 발표', date: '2026-11-11', endDate: '2026-11-20',
  done: 0, important: 0, sortOrder: 1, subtasks: [], projectId: null, projectHue: null,
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
let shortcut, catalogRenderer;
function findComposer(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'catalogRows') catalogRenderer = node.getText(plannerSource);
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

assert.ok(catalogRenderer);
const createCatalogRenderer = new Function('backlog', 'catalog', 'catalogError', 'taskRow', 'PlannerBacklogRow', 'createElement', 'Fragment', 'date', 'busy', 'mutate', 'removeBacklog', 'PlannerSortableList', 'setDragging',
  ts.transpileModule(catalogRenderer, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'createElement', jsxFragmentFactory: 'Fragment' } }).outputText + '\nreturn catalogRows;');
const renderCatalog = (tasks, backlog) => renderToStaticMarkup(createCatalogRenderer(
  backlog, tasks, '', value => createElement('li', { key: value.id }, value.title), PlannerBacklogRow, createElement, Fragment, task.date, false, async () => true, () => {}, PlannerSortableList, () => {},
)(tasks, '작업 없음'));
const undatedWork = { id: 'undated-work', title: '날짜 없는 작업', sortOrder: 2, taskId: null, taskTitle: null, taskDate: null, taskEndDate: null, projectId: null, projectTitle: null, projectHue: null };
const mixedCatalog = renderCatalog([task, { ...task, id: 'finished', title: '끝낸 작업', done: 1 }], [
  undatedWork,
  { ...undatedWork, id: 'nested-draft', taskId: task.id, title: '부모 안의 세부 계획' },
  { ...undatedWork, id: 'nested-child', taskId: task.id, subtask: 1, title: '부모 안의 하위 할 일' },
]);
assert.match(mixedCatalog, /class="sortable-list task-list task-work-list">[\s\S]*강화학습 논문 발표[\s\S]*날짜 없는 작업[\s\S]*<\/ul><details class="completed-work">/, 'Dated and undated work share one list before completed work');
assert.doesNotMatch(mixedCatalog, /부모 안의/, 'Undated children stay with their parent instead of appearing as separate work');
assert.match(mixedCatalog, /aria-label="날짜 없는 작업 날짜 지정"/, 'Undated work keeps its scheduling control');
assert.match(renderCatalog([], []), /작업 없음/);
assert.doesNotMatch(renderCatalog([], [undatedWork]), /작업 없음/, 'An undated-only list is not empty');
assert.match(renderCatalog([task], [{ ...undatedWork, sortOrder: 0 }]), /날짜 없는 작업[\s\S]*강화학습 논문 발표/, 'A saved undated position can precede dated work');
assert.match(mixedCatalog, /data-sort-handle="true" draggable="true"/, 'Undated work has an enabled drag handle');
assert.doesNotMatch(render({ readOnly: true }), /data-sort-handle/, 'Other people cannot drag this task');
console.log('Work list checks passed: undated work in the main list, parent-only subtasks, and completed work below.');

const taskSource = ts.createSourceFile('planner-task.tsx', readFileSync(new URL('../components/planner-task.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let scheduleChange, editScheduleChange;
function findScheduleControl(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(taskSource) === 'input') {
    const label = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(taskSource) === 'aria-label')?.initializer?.text;
    const handler = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(taskSource) === 'onChange')?.initializer?.expression?.getText(taskSource);
    if (label === '하위 할 일 날짜 지정') scheduleChange = handler;
    if (label === '기존 하위 할 일 날짜 지정') editScheduleChange = handler;
  }
  ts.forEachChild(node, findScheduleControl);
}
findScheduleControl(taskSource);
assert.ok(scheduleChange && editScheduleChange, 'Subtask creation and editing both use date checkboxes');
const selectSchedule = new Function('setChildScheduled', `return (${scheduleChange});`);
const editSchedule = new Function('setEditChild', 'editChild', `return (${editScheduleChange});`);
for (const checked of [true, false]) {
  let selected, edited;
  selectSchedule(value => { selected = value; })({ target: { checked } });
  assert.equal(selected, checked, 'Checking enables scheduling and unchecking disables it');
  const draft = { id: 'child', title: 'Keep title', date: '2026-11-15', done: 1, scheduled: !checked };
  editSchedule(value => { edited = value; }, draft)({ target: { checked } });
  assert.deepEqual(edited, { ...draft, scheduled: checked }, 'Toggling the checkbox keeps the selected date and task state');
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
for (const readOnly of [false, true]) {
  const dailyParent = render({ task: { ...parent, subtasks: [...children, { ...children[0], id: 'unscheduled', title: '날짜 없는 하위 작업', date: null }] }, grouped: true, dailyOnly: true, readOnly, backlog: [undatedChild], onDeleteBacklog() {} });
  assert.match(dailyParent, /오늘의 하위 할 일/);
  assert.doesNotMatch(dailyParent, /다른 날짜의 하위 할 일|날짜 없는 하위 작업|날짜 미정 세부 작업/, 'The shared daily view excludes future and undated children for owners and viewers');
  assert.match(dailyParent, /하위 할 일 <span>0 \/ 1<\/span>/, 'The daily parent count matches its visible children');
  assert.doesNotMatch(dailyParent, /＋ 하위 할 일|aria-label="오늘의 하위 할 일 (위로|아래로) 이동"/);
}
assert.match(render({ task: parent, grouped: true }), /다른 날짜의 하위 할 일/, 'The work list still shows the full plan');
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
const existingChildEditor = render({ task: parent, initialChildId: 'today-child' });
const dateControl = html => html.match(/<input\b[^>]*aria-label="하위 할 일 날짜"[^>]*>/)?.[0];
const scheduleCheckbox = html => html.match(/<input\b[^>]*aria-label="기존 하위 할 일 날짜 지정"[^>]*>/)?.[0];
assert.match(scheduleCheckbox(existingChildEditor), /checked=""/);
assert.ok(dateControl(existingChildEditor));
assert.doesNotMatch(dateControl(existingChildEditor), /disabled=""/);
const undatedEditor = render({ task: { ...parent, subtasks: [{ ...children[0], date: null }] }, initialChildId: 'today-child' });
assert.doesNotMatch(scheduleCheckbox(undatedEditor), /checked=""/);
assert.match(dateControl(undatedEditor), /disabled=""/, 'An undated existing item keeps its date field visible and disabled');
assert.match(dateControl(undatedEditor), /value="2026-11-11"/);
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
await changeWork(db, owner, { op: 'task.link', taskId: future.id, artifactId: project.id });
const savedChild = catalog[0].subtasks[0];
const childRecord = await changeWork(db, owner, { op: 'entry.add', artifactId: project.id, taskId: future.id, subtaskId: savedChild.id, kind: 'result', title: 'Keep child link', occurredAt: '2041-01-02T00:00:00Z' });
const unchanged = () => sqlite.prepare('SELECT id,task_id,title,done,sort_order,created_at FROM task_subtasks WHERE id=?').get(savedChild.id);
const originalChild = unchanged();
await change(db, owner, { op: 'subtask.patch', id: savedChild.id, date: null });
assert.deepEqual(unchanged(), originalChild, 'Removing a date keeps identity, completion, order, and content');
assert.equal((await readTaskCatalog(db, owner)).find(item => item.id === future.id).subtasks.find(item => item.id === savedChild.id).date, null);
assert.equal((await readBacklog(db, owner)).find(item => item.id === savedChild.id).done, 1, 'Completed items keep completion in the backlog');
assert.equal(sqlite.prepare('SELECT subtask_id FROM work_entries WHERE id=?').get(childRecord.id).subtask_id, savedChild.id);
assert.ok(!(await readDay(db, other, '2041-01-02', true)).tasks.flatMap(item => item.subtasks).some(item => item.id === savedChild.id), 'Other people cannot read undated details');
assert.ok(!widgetPlan(await readDay(db, owner, '2041-01-02', true)).tasks.some(item => item.id === savedChild.id));
await assert.rejects(change(db, other, { op: 'subtask.patch', id: savedChild.id, date: null }), error => error.status === 403);
await assert.rejects(change(db, owner, { op: 'subtask.patch', id: savedChild.id, done: false }, '2041-01-02'), error => error.status === 409);
await change(db, owner, { op: 'task.patch', id: future.id, date: '2041-01-03' });
await assert.rejects(change(db, owner, { op: 'backlog.schedule', id: savedChild.id, date: '2041-01-02' }));
await change(db, owner, { op: 'backlog.schedule', id: savedChild.id, date: '2041-01-04' });
assert.deepEqual(unchanged(), originalChild, 'Assigning a new date also retains state and order');
assert.equal((await readTaskCatalog(db, owner)).find(item => item.id === future.id).subtasks.find(item => item.id === savedChild.id).date, '2041-01-04');
assert.equal(sqlite.prepare('SELECT subtask_id FROM work_entries WHERE id=?').get(childRecord.id).subtask_id, savedChild.id);
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
const keptRecord = pending.entries.find(item => item.id === record.id);
assert.equal(keptRecord.body, 'Keep this report.');
assert.equal(keptRecord.files[0].id, 'file');
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM work_file_chunks').get().n, 1);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM work_github_versions').get().n, 1);
assert.equal((await readBacklog(db, owner)).find(item => item.id === remaining.id).projectId, null, 'Project deletion keeps and unlinks undated work');
await change(db, owner, { op: 'backlog.delete', id: remaining.id });
assert.equal((await readBacklog(db, owner)).length, 0);
console.log('Task checks passed: collapse controls, private undated work, date assignment, project deletion with records/files preserved, and completed ordering.');

const sortOwner = { userId: 'sort-owner', email: 'sort@example.test' };
const sortOther = { userId: 'sort-other', email: 'sort-other@example.test' };
const periodA = await change(db, sortOwner, { op: 'task.add', date: '2045-01-01', endDate: '2045-01-07', title: 'Period A' });
const periodB = await change(db, sortOwner, { op: 'task.add', date: '2046-01-01', endDate: '2046-01-07', title: 'Period B' });
const undatedA = await change(db, sortOwner, { op: 'backlog.add', title: 'Undated A' });
const undatedB = await change(db, sortOwner, { op: 'backlog.add', title: 'Undated B' });
const rootOrder = async () => [...await readTaskCatalog(db, sortOwner), ...(await readBacklog(db, sortOwner)).filter(item => !item.taskId)]
  .sort((a, b) => (a.done ?? 0) - (b.done ?? 0) || a.sortOrder - b.sortOrder).map(item => item.id);
await change(db, sortOwner, { op: 'task.move', scope: 'all', id: undatedA.id, targetId: periodA.id, position: 'before' });
await change(db, sortOwner, { op: 'task.move', scope: 'all', id: periodB.id, targetId: undatedA.id, position: 'after' });
assert.deepEqual(await rootOrder(), [undatedA.id, periodB.id, periodA.id, undatedB.id], 'Different dates and undated work share a persistent order');
const appended = await change(db, sortOwner, { op: 'task.add', date: '2045-01-01', title: 'New work' });
assert.deepEqual(await rootOrder(), [undatedA.id, periodB.id, periodA.id, undatedB.id, appended.id], 'New dated work follows existing undated work');
await change(db, sortOwner, { op: 'backlog.schedule', id: undatedA.id, date: '2045-01-01' });
assert.deepEqual(await rootOrder(), [undatedA.id, periodB.id, periodA.id, undatedB.id, appended.id], 'Assigning a date keeps the saved position');
const sortChildA = await change(db, sortOwner, { op: 'subtask.add', taskId: periodA.id, date: '2045-01-01', title: 'Dated child' });
const sortChildB = await change(db, sortOwner, { op: 'backlog.add', taskId: periodA.id, title: 'Undated child' });
const sortChildC = await change(db, sortOwner, { op: 'subtask.add', taskId: periodA.id, date: '2045-01-02', title: 'Later child' });
const childOrder = async () => [...(await readTaskCatalog(db, sortOwner)).find(item => item.id === periodA.id).subtasks, ...(await readBacklog(db, sortOwner)).filter(item => item.taskId === periodA.id && !item.subtask)]
  .sort((a, b) => (a.done ?? 0) - (b.done ?? 0) || a.sortOrder - b.sortOrder).map(item => item.id);
await change(db, sortOwner, { op: 'subtask.move', scope: 'all', id: sortChildB.id, targetId: sortChildA.id, position: 'before' });
assert.deepEqual(await childOrder(), [sortChildB.id, sortChildA.id, sortChildC.id], 'Undated children can move among dated siblings');
await change(db, sortOwner, { op: 'subtask.move', scope: 'all', id: sortChildC.id, targetId: sortChildA.id, position: 'before' });
assert.deepEqual(await childOrder(), [sortChildB.id, sortChildC.id, sortChildA.id]);
const sortParent = (await readTaskCatalog(db, sortOwner)).find(item => item.id === periodA.id);
assert.equal(sortParent.date, '2045-01-01');
assert.equal(sortParent.endDate, '2045-01-07');
assert.equal(sortParent.subtasks.find(item => item.id === sortChildC.id).date, '2045-01-02', 'Dragging changes order, not the schedule');
await change(db, sortOwner, { op: 'backlog.schedule', id: sortChildB.id, date: '2045-01-01' });
assert.deepEqual(await childOrder(), [sortChildB.id, sortChildC.id, sortChildA.id]);
assert.deepEqual(widgetPlan(await readDay(db, sortOwner, '2045-01-01')).tasks.map(item => item.id), [undatedA.id, sortChildB.id, sortChildA.id, appended.id], 'Widget receives the saved daily task and subtask order');
await change(db, sortOwner, { op: 'subtask.patch', id: sortChildB.id, done: true });
assert.deepEqual(await childOrder(), [sortChildC.id, sortChildA.id, sortChildB.id], 'Completion still moves a child below unfinished work');
await assert.rejects(change(db, sortOwner, { op: 'subtask.move', scope: 'all', id: sortChildB.id, targetId: sortChildA.id }), error => error.status === 409);
const otherParentChild = await change(db, sortOwner, { op: 'backlog.add', taskId: periodB.id, title: 'Another parent' });
await assert.rejects(change(db, sortOwner, { op: 'subtask.move', scope: 'all', id: sortChildA.id, targetId: otherParentChild.id }), error => error.status === 403);
const otherWork = await change(db, sortOther, { op: 'backlog.add', title: 'Other owner' });
for (const [id, targetId] of [[otherWork.id, undatedB.id], [undatedB.id, otherWork.id]]) {
  await assert.rejects(change(db, sortOwner, { op: 'task.move', scope: 'all', id, targetId }), error => error.status === 403);
}
await assert.rejects(change(db, sortOwner, { op: 'task.move', scope: 'invalid', id: undatedB.id, targetId: periodA.id }), error => error.status === 400);
console.log('Unified order checks passed: cross-date tasks, undated work, siblings, scheduling, widget order, completion and owner-only moves.');
sqlite.close();

const beforeOrder = new DatabaseSync(':memory:');
for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql') && name < '0012_backlog_order.sql').sort()) beforeOrder.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
beforeOrder.exec(`INSERT INTO members VALUES ('owner','Owner','owner@example.test','2045-01-01');
  INSERT INTO tasks (id,owner_id,date,title,sort_order,created_at,updated_at) VALUES ('parent','owner','2045-01-01','Parent',7,'2045-01-01','2045-01-01');
  INSERT INTO task_subtasks (id,task_id,date,title,sort_order,created_at,updated_at) VALUES ('child','parent','2045-01-01','Child',4,'2045-01-01','2045-01-01');
  INSERT INTO task_backlog (id,owner_id,task_id,title,created_at,updated_at) VALUES
    ('root-draft','owner',NULL,'Root draft','2045-01-01','2045-01-01'),
    ('child-draft','owner','parent','Child draft','2045-01-01','2045-01-01');`);
const oldDrafts = beforeOrder.prepare('SELECT id,owner_id,task_id,title,created_at,updated_at FROM task_backlog ORDER BY id').all();
beforeOrder.exec(readFileSync(new URL('../drizzle/0012_backlog_order.sql', import.meta.url), 'utf8'));
assert.deepEqual(beforeOrder.prepare('SELECT id,owner_id,task_id,title,created_at,updated_at FROM task_backlog ORDER BY id').all(), oldDrafts, 'The order migration keeps existing drafts unchanged');
assert.deepEqual(beforeOrder.prepare('SELECT id,sort_order FROM task_backlog ORDER BY id').all().map(row => [row.id, row.sort_order]), [['child-draft', 5], ['root-draft', 8]], 'Existing drafts keep their place after existing tasks and children');
beforeOrder.close();
console.log('Backlog order migration checks passed.');

const weekTasks = Array.from({ length: 7 }, (_, index) => ({ ...task, id: `week-task-${index}`, date: '2026-11-12', endDate: null, done: Number(index > 3) }));
weekTasks.push({ ...task, id: 'next-day-parent', date: '2026-11-11', endDate: '2026-11-20', subtasks: [
  { id: 'next-day-child', taskId: 'next-day-parent', title: 'Tomorrow only', date: '2026-11-13', done: 0, sortOrder: 1 },
  { id: 'undated-week-child', taskId: 'next-day-parent', title: 'Not scheduled', date: null, done: 0, sortOrder: 2 },
] }, { ...task, id: 'foreign-week-task', ownerId: 'someone-else', date: '2026-11-12', endDate: null });
const weekEvents = [
  { ownerId: task.ownerId, calendarId: 'calendar', eventId: 'meeting', title: 'Friday meeting', date: '2026-11-13', sourceName: 'My Calendar' },
  { ownerId: 'someone-else', calendarId: 'other-calendar', eventId: 'private', title: 'Private meeting', date: '2026-11-13', sourceName: 'Other Calendar' },
];
const widgetDay = { date: '2026-11-12', me: { id: task.ownerId, name: 'Me' }, tasks: weekTasks, milestones: [] };
const weekWidget = widgetWeekPlan(widgetDay, { from: '2026-11-09', to: '2026-11-15', tasks: weekTasks, milestones: weekEvents });
assert.equal(weekWidget.tasks.length, 7, 'Calendar widgets receive all daily tasks');
assert.equal(widgetPlan(widgetDay).tasks.length, 4, 'Older widgets retain their compatible response');
assert.deepEqual(weekWidget.days.map(day => day.date), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
assert.deepEqual(weekWidget.days[4].tasks.map(item => item.id), ['next-day-child']);
assert.equal(weekWidget.days[3].tasks.length, 7, 'Tomorrow and undated subtasks do not enter today');
assert.deepEqual(weekWidget.days[4].events.map(event => event.title), ['Friday meeting']);
assert.ok(!JSON.stringify(weekWidget).includes('Private meeting') && !JSON.stringify(weekWidget).includes('foreign-week-task'), 'Only the owner’s task and calendar details reach the widget');
console.log('Weekly widget checks passed: full task lists, exact dates, private calendars and legacy compatibility.');
