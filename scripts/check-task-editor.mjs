import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { dailyTaskItems } from '../lib/planner-core.ts';

let code = ts.transpileModule(readFileSync(new URL('../components/planner-task.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
for (const name of ['react', 'react/jsx-runtime', 'lucide-react']) code = code.replaceAll(JSON.stringify(name), JSON.stringify(import.meta.resolve(name)));
code = code.replaceAll('"../lib/planner-core"', JSON.stringify(new URL('../lib/planner-core.ts', import.meta.url).href));
const { PlannerTask } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
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
