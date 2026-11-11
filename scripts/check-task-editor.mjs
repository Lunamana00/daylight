import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { change, dailyTaskItems, readTaskCatalog } from '../lib/planner-core.ts';

Error.stackTraceLimit = 0;

let code = ts.transpileModule(readFileSync(new URL('../components/planner-task.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
for (const name of ['react', 'react/jsx-runtime', 'lucide-react']) code = code.replaceAll(JSON.stringify(name), JSON.stringify(import.meta.resolve(name)));
code = code.replaceAll('"../lib/planner-core"', JSON.stringify(new URL('../lib/planner-core.ts', import.meta.url).href));
const { PlannerTask, PlannerDailySubtask } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
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
assert.match(editor, /aria-label="강화학습 논문 발표 하위 할 일 추가"/);
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

const grouped = render({ grouped: true });
assert.doesNotMatch(grouped, /aria-label="강화학습 논문 발표 완료"/, 'Long work is a group, not a daily completion checkbox');
assert.match(grouped, /task-title-edit/);
assert.match(grouped, /＋ 하위 할 일/);
const children = [
  { id: 'today-child', taskId: task.id, title: '오늘의 하위 할 일', date: task.date, done: 0, sortOrder: 0 },
  { id: 'later-child', taskId: task.id, title: '다른 날짜의 하위 할 일', date: '2026-11-12', done: 0, sortOrder: 1 },
];
const parent = { ...task, subtasks: children, projectTitle: '연구 프로젝트', projectId: 'project' };
const childRow = renderToStaticMarkup(createElement(PlannerDailySubtask, { ...props, task: parent, child: children[0], onOpenTask() {} }));
assert.match(childRow, /오늘의 하위 할 일/);
assert.match(childRow, /강화학습 논문 발표/);
assert.match(childRow, /연구 프로젝트/);
assert.doesNotMatch(childRow, /다른 날짜의 하위 할 일/, 'The daily row contains only the selected execution item');
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
sqlite.close();
console.log('Task layout checks passed: grouped work, daily children, direct editing, private all-date catalog, and completed ordering.');
