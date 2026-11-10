import { day, ensureMember, PlannerError } from "./planner-core";
import type { Identity } from "./planner-core";
import type { WorkArtifact, WorkCatalog, WorkConnection, WorkDetail, WorkEntry, WorkFile, WorkKind, WorkLink, WorkStage, WorkTask } from "./work-log-types";
import { workSummaryFields } from "./work-log-types";

export function workText(value: unknown, label: string, max = 240, empty = false) {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.trim().length > max) throw new PlannerError(`${label}을 확인해 주세요.`);
  return value.trim();
}
export function workObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlannerError("올바른 기록이 아닙니다.");
  return value as Record<string, unknown>;
}
function url(value: unknown): string | null {
  if (value == null || value === "") return null;
  try {
    const parsed = new URL(workText(value, "자료 주소", 2048));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
    return parsed.href;
  } catch { throw new PlannerError("자료 링크는 https 주소로 입력해 주세요."); }
}
function content(input: Record<string, unknown>) {
  if (!["plan", "decision", "progress", "result"].includes(String(input.kind))) throw new PlannerError("기록 종류를 선택해 주세요.");
  const links = input.links ?? [];
  if (!Array.isArray(links) || links.length > 8) throw new PlannerError("결과 링크는 8개까지 저장할 수 있어요.");
  const occurredAt = workText(input.occurredAt, "작업 시각", 40);
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt))) throw new PlannerError("시간대가 포함된 작업 시각이 필요해요.");
  const time = new Date(occurredAt).toISOString();
  day(time.slice(0, 10));
  return {
    kind: input.kind as WorkKind, title: workText(input.title, "기록 제목"), body: workText(input.body ?? "", "기록 내용", 8000, true),
    links: links.map(value => { const link = workObject(value); const href = url(link.url); if (!href) throw new PlannerError("자료 주소가 필요해요."); return { label: workText(link.label, "자료 이름", 200), url: href }; }),
    occurredAt: time, sourceUrl: url(input.sourceUrl),
  };
}
export async function ownedArtifact(db: D1Database, ownerId: string, id: unknown) {
  const artifact = (await db.prepare("SELECT id,title,description,url,background,contribution,decisions,results,reflection,updated_at AS updatedAt FROM work_artifacts WHERE id=? AND owner_id=?").bind(workText(id, "작업물", 100), ownerId).all<WorkArtifact>()).results[0];
  if (!artifact) throw new PlannerError("작업물을 찾을 수 없어요.", 404);
  return artifact;
}
async function associations(db: D1Database, ownerId: string, input: Record<string, unknown>) {
  const artifactId = input.artifactId == null ? null : (await ownedArtifact(db, ownerId, input.artifactId)).id;
  const stageId = input.stageId == null ? null : workText(input.stageId, "진행 단계", 100);
  const taskId = input.taskId == null ? null : workText(input.taskId, "할 일", 100);
  const subtaskId = input.subtaskId == null ? null : workText(input.subtaskId, "하위 할 일", 100);
  if (!artifactId && (stageId || taskId || subtaskId)) throw new PlannerError("먼저 작업물을 선택해 주세요.");
  if (stageId && !(await db.prepare("SELECT id FROM work_stages WHERE id=? AND artifact_id=?").bind(stageId, artifactId).all()).results.length) throw new PlannerError("이 작업물의 단계를 선택해 주세요.");
  if (taskId && !(await db.prepare("SELECT t.id FROM tasks t JOIN work_task_links l ON l.task_id=t.id WHERE t.id=? AND t.owner_id=? AND l.artifact_id=?").bind(taskId, ownerId, artifactId).all()).results.length) throw new PlannerError("이 작업물에 연결된 본인의 할 일을 선택해 주세요.", 403);
  if (subtaskId && (!taskId || !(await db.prepare("SELECT id FROM task_subtasks WHERE id=? AND task_id=?").bind(subtaskId, taskId).all()).results.length)) throw new PlannerError("하위 할 일을 확인해 주세요.");
  return { artifactId, stageId, taskId, subtaskId };
}
export async function readWorkCatalog(db: D1Database, user: Identity): Promise<WorkCatalog> {
  const artifacts = await db.prepare(`SELECT a.id,a.title,a.description,a.url,a.background,a.contribution,a.decisions,a.results,a.reflection,a.updated_at AS updatedAt,
    (SELECT count(*) FROM work_entries e WHERE e.artifact_id=a.id AND e.owner_id=a.owner_id AND e.hidden=0) AS entryCount,
    (SELECT count(*) FROM work_task_links l JOIN tasks t ON t.id=l.task_id WHERE l.artifact_id=a.id AND t.owner_id=a.owner_id) AS taskCount
    FROM work_artifacts a WHERE a.owner_id=? ORDER BY a.updated_at DESC,a.id`).bind(user.userId).all<WorkArtifact>();
  const pending = (await db.prepare("SELECT count(*) AS n FROM work_entries WHERE owner_id=? AND artifact_id IS NULL AND hidden=0").bind(user.userId).all<{ n: number }>()).results[0].n;
  return { artifacts: artifacts.results, pending };
}
export async function readWorkDetail(db: D1Database, ownerId: string, artifactId: string | null, cursor?: string | null, stageId?: string | null, limit = 100, materialsOnly = false): Promise<WorkDetail> {
  if (artifactId) await ownedArtifact(db, ownerId, artifactId);
  let beforeTime: string | null = null, beforeId: string | null = null;
  if (cursor) {
    const parts = workText(cursor, "다음 기록 위치", 160).split("|");
    if (parts.length !== 2 || !Number.isFinite(Date.parse(parts[0])) || !/^[a-f0-9-]{16,100}$/.test(parts[1])) throw new PlannerError("기록을 다시 불러와 주세요.");
    [beforeTime, beforeId] = parts;
  }
  const records = await db.prepare(`SELECT e.id,e.artifact_id AS artifactId,e.stage_id AS stageId,e.task_id AS taskId,e.subtask_id AS subtaskId,
    e.kind,e.title,e.body,e.links,e.provider,e.source_key AS sourceKey,e.source_url AS sourceUrl,e.occurred_at AS occurredAt,e.featured,
    t.title AS taskTitle,s.title AS subtaskTitle,g.title AS stageTitle
    FROM work_entries e LEFT JOIN tasks t ON t.id=e.task_id AND t.owner_id=e.owner_id
    LEFT JOIN task_subtasks s ON s.id=e.subtask_id AND s.task_id=t.id LEFT JOIN work_stages g ON g.id=e.stage_id AND g.artifact_id=e.artifact_id
    WHERE e.owner_id=? AND e.artifact_id IS ? AND e.hidden=0 AND (? IS NULL OR e.stage_id=?) AND (? IS NULL OR e.occurred_at<? OR (e.occurred_at=? AND e.id<?))
    AND (?=0 OR json_array_length(e.links)>0 OR EXISTS (SELECT 1 FROM work_files f WHERE f.entry_id=e.id AND f.owner_id=e.owner_id))
    ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?`).bind(ownerId, artifactId, stageId || null, stageId || null, beforeTime, beforeTime, beforeTime, beforeId, Number(materialsOnly), limit + 1).all<Omit<WorkEntry, "links" | "files"> & { links: string }>();
  const page = records.results.slice(0, limit);
  const files = page.length ? (await db.prepare("SELECT id,entry_id AS entryId,file_name AS fileName,content_type AS contentType,size,created_at AS createdAt FROM work_files WHERE owner_id=? AND entry_id IN (SELECT value FROM json_each(?)) ORDER BY created_at,id").bind(ownerId, JSON.stringify(page.map(e => e.id))).all<WorkFile>()).results : [];
  const tasks = artifactId ? (await db.prepare("SELECT t.id,t.title,t.date,t.end_date AS endDate,t.done,l.stage_id AS stageId FROM tasks t JOIN work_task_links l ON l.task_id=t.id WHERE l.artifact_id=? AND t.owner_id=? ORDER BY t.created_at,t.rowid").bind(artifactId, ownerId).all<WorkTask>()).results : [];
  const children = artifactId ? (await db.prepare("SELECT s.id,s.task_id AS taskId,s.title,s.date,s.done FROM task_subtasks s JOIN tasks t ON t.id=s.task_id JOIN work_task_links l ON l.task_id=t.id WHERE l.artifact_id=? AND t.owner_id=? ORDER BY s.date,s.created_at,s.rowid").bind(artifactId, ownerId).all<WorkTask["subtasks"][number] & { taskId: string }>()).results : [];
  const stages = artifactId ? (await db.prepare("SELECT id,title,position,status FROM work_stages WHERE artifact_id=? ORDER BY position,id").bind(artifactId).all<WorkStage>()).results : [];
  const connections = artifactId ? (await db.prepare("SELECT id,artifact_id AS artifactId,provider,scope,expires_at AS expiresAt,last_sync_at AS lastSyncAt,revoked_at AS revokedAt FROM work_connections WHERE owner_id=? AND artifact_id=? ORDER BY created_at DESC").bind(ownerId, artifactId).all<WorkConnection>()).results : [];
  const last = page[page.length - 1];
  return {
    entries: page.map(entry => ({ ...entry, links: JSON.parse(entry.links) as WorkLink[], files: files.filter(file => file.entryId === entry.id) })),
    nextCursor: records.results.length > limit ? `${last.occurredAt}|${last.id}` : null,
    tasks: tasks.map(task => { const subtasks = children.filter(child => child.taskId === task.id); return { ...task, subtasks, done: subtasks.length ? Number(subtasks.every(child => child.done)) : task.done }; }), stages, connections,
  };
}
export async function changeWork(db: D1Database, user: Identity, input: Record<string, unknown>) {
  await ensureMember(db, user);
  const now = new Date().toISOString();
  if (input.op === "artifact.add" || input.op === "artifact.patch") {
    const adding = input.op === "artifact.add";
    const id = adding ? crypto.randomUUID() : (await ownedArtifact(db, user.userId, input.id)).id;
    const title = workText(input.title, "작업물 이름", 120), description = workText(input.description ?? "", "최종 목표", 2000, true), href = url(input.url);
    if (!adding) {
      const fields = ["title=?", "description=?", "url=?", "updated_at=?"], values: (string | null)[] = [title, description, href, now];
      for (const field of workSummaryFields) if (input[field.key] !== undefined) {
        fields.push(`${field.key}=?`); values.push(workText(input[field.key], field.label, 4000, true));
      }
      await db.prepare(`UPDATE work_artifacts SET ${fields.join(",")} WHERE id=? AND owner_id=?`).bind(...values, id, user.userId).run();
    }
    else {
      if (!Array.isArray(input.stages) || input.stages.length < 1 || input.stages.length > 20) throw new PlannerError("진행 단계를 1~20개 입력해 주세요.");
      const stages = input.stages.map(value => workText(value, "단계 이름", 120));
      await db.batch([
        db.prepare("INSERT INTO work_artifacts (id,owner_id,title,description,url,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id, user.userId, title, description, href, now, now),
        ...stages.map((stage, index) => db.prepare("INSERT INTO work_stages (id,artifact_id,title,position) VALUES (?,?,?,?)").bind(crypto.randomUUID(), id, stage, index)),
      ]);
    }
    return { id };
  }
  if (input.op === "stage.add" || input.op === "stage.patch") {
    const artifact = await ownedArtifact(db, user.userId, input.artifactId);
    const title = workText(input.title, "단계 이름", 120);
    if (input.op === "stage.add") {
      const id = crypto.randomUUID();
      const result = await db.prepare("INSERT INTO work_stages (id,artifact_id,title,position) SELECT ?,?,?,COALESCE(max(position),-1)+1 FROM work_stages WHERE artifact_id=? HAVING count(*)<20").bind(id, artifact.id, title, artifact.id).run();
      if (!result.meta.changes) throw new PlannerError("단계는 20개까지 만들 수 있어요.");
      return { id };
    }
    if (!["planned", "active", "done"].includes(String(input.status))) throw new PlannerError("단계 상태를 선택해 주세요.");
    const result = await db.prepare("UPDATE work_stages SET title=?,status=? WHERE id=? AND artifact_id=?").bind(title, input.status as string, workText(input.id, "단계", 100), artifact.id).run();
    if (!result.meta.changes) throw new PlannerError("단계를 찾을 수 없어요.", 404);
    return { saved: true };
  }
  if (input.op === "task.link") {
    const taskId = workText(input.taskId, "할 일", 100);
    if (!(await db.prepare("SELECT id FROM tasks WHERE id=? AND owner_id=?").bind(taskId, user.userId).all()).results.length) throw new PlannerError("본인의 할 일만 연결할 수 있어요.", 403);
    if (input.artifactId == null) await db.prepare("DELETE FROM work_task_links WHERE task_id=?").bind(taskId).run();
    else {
      const link = await associations(db, user.userId, { artifactId: input.artifactId, stageId: input.stageId });
      await db.prepare("INSERT INTO work_task_links (task_id,artifact_id,stage_id) VALUES (?,?,?) ON CONFLICT(task_id) DO UPDATE SET artifact_id=excluded.artifact_id,stage_id=excluded.stage_id").bind(taskId, link.artifactId, link.stageId).run();
    }
    return { saved: true };
  }
  if (input.op === "entry.add") {
    const link = await associations(db, user.userId, input), entry = content(input), id = crypto.randomUUID();
    await db.prepare("INSERT INTO work_entries (id,owner_id,artifact_id,stage_id,task_id,subtask_id,kind,title,body,links,provider,source_key,source_url,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'manual',?,?,?,?)")
      .bind(id, user.userId, link.artifactId, link.stageId, link.taskId, link.subtaskId, entry.kind, entry.title, entry.body, JSON.stringify(entry.links), id, entry.sourceUrl, entry.occurredAt, now).run();
    return { id };
  }
  if (input.op === "entry.patch") {
    const id = workText(input.id, "기록", 100);
    const old = (await db.prepare("SELECT artifact_id AS artifactId,stage_id AS stageId,task_id AS taskId,subtask_id AS subtaskId FROM work_entries WHERE id=? AND owner_id=? AND hidden=0").bind(id, user.userId).all<{ artifactId: string | null; stageId: string | null; taskId: string | null; subtaskId: string | null }>()).results[0];
    if (!old) throw new PlannerError("기록을 찾을 수 없어요.", 404);
    const fields: string[] = [], values: (string | number | null)[] = [];
    if (["artifactId", "stageId", "taskId", "subtaskId"].some(key => input[key] !== undefined)) {
      const link = await associations(db, user.userId, { ...old, ...input });
      fields.push("artifact_id=?", "stage_id=?", "task_id=?", "subtask_id=?"); values.push(link.artifactId, link.stageId, link.taskId, link.subtaskId);
    }
    if (input.title !== undefined) { fields.push("title=?"); values.push(workText(input.title, "기록 제목")); }
    if (input.body !== undefined) { fields.push("body=?"); values.push(workText(input.body, "기록 내용", 8000, true)); }
    for (const flag of ["featured", "hidden"] as const) if (input[flag] !== undefined) {
      if (typeof input[flag] !== "boolean") throw new PlannerError("기록 설정을 확인해 주세요.");
      fields.push(`${flag}=?`); values.push(Number(input[flag]));
    }
    if (!fields.length) throw new PlannerError("변경할 내용이 없어요.");
    await db.prepare(`UPDATE work_entries SET ${fields.join(",")} WHERE id=? AND owner_id=?`).bind(...values, id, user.userId).run();
    return { id };
  }
  if (input.op === "connection.add") return createWorkConnection(db, user, input);
  if (input.op === "connection.revoke") {
    const result = await db.prepare("UPDATE work_connections SET revoked_at=? WHERE id=? AND owner_id=?").bind(now, workText(input.id, "연결", 100), user.userId).run();
    if (!result.meta.changes) throw new PlannerError("연결을 찾을 수 없어요.", 404);
    return { saved: true };
  }
  throw new PlannerError("지원하지 않는 요청입니다.");
}
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
function sourceScope(provider: "codex" | "chatgpt", value: unknown) {
  const scope = workText(value, "기록을 가져올 곳", 2048);
  if (provider === "codex") {
    if (/^codex-thread:[a-f0-9-]{36}$/.test(scope)) return scope;
    if (!scope.startsWith("/") || scope === "/" || scope.split("/").some(part => part === ".." || part === ".") || /[\x00-\x1f]/.test(scope)) throw new PlannerError("Codex 프로젝트 폴더의 전체 경로를 입력해 주세요.");
    return scope.replace(/\/+$/, "");
  }
  const parsed = new URL(url(scope)!);
  if (parsed.hostname !== "chatgpt.com" || !/^\/(?:c\/[^/]+|g\/g-p-[^/]+\/(?:project|c\/[^/]+))\/?$/.test(parsed.pathname)) throw new PlannerError("ChatGPT 프로젝트나 대화 주소를 입력해 주세요.");
  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}
async function createWorkConnection(db: D1Database, user: Identity, input: Record<string, unknown>) {
  const artifact = await ownedArtifact(db, user.userId, input.artifactId);
  if (input.provider !== "codex" && input.provider !== "chatgpt") throw new PlannerError("연결할 앱을 선택해 주세요.");
  const scope = sourceScope(input.provider, input.scope), id = crypto.randomUUID();
  const secret = "dwl_" + Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString(), expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const result = await db.prepare(`INSERT INTO work_connections (id,owner_id,artifact_id,provider,scope,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(owner_id,provider,scope) DO UPDATE SET id=excluded.id,artifact_id=excluded.artifact_id,token_hash=excluded.token_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,last_sync_at=NULL,revoked_at=NULL WHERE work_connections.revoked_at IS NOT NULL OR work_connections.expires_at<=excluded.created_at`)
    .bind(id, user.userId, artifact.id, input.provider, scope, await digest(secret), now, expiresAt).run();
  if (!result.meta.changes) throw new PlannerError("이미 등록된 연결이에요. 기존 연결을 해제한 뒤 다시 등록해 주세요.", 409);
  return { id, secret, provider: input.provider, scope, expiresAt };
}
export type CollectorConnection = WorkConnection & { ownerId: string };
export async function workConnection(db: D1Database, authorization: string | null): Promise<CollectorConnection | null> {
  if (!authorization || !/^Bearer dwl_[a-f0-9]{64}$/.test(authorization)) return null;
  return (await db.prepare("SELECT id,owner_id AS ownerId,artifact_id AS artifactId,provider,scope,expires_at AS expiresAt,last_sync_at AS lastSyncAt,revoked_at AS revokedAt FROM work_connections WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?")
    .bind(await digest(authorization.slice(7)), new Date().toISOString()).all<CollectorConnection>()).results[0] ?? null;
}
export async function ingestWork(db: D1Database, connection: CollectorConnection, input: Record<string, unknown>) {
  // Ownership checks and the atomic write must fit the D1 Free request budget.
  if (!Array.isArray(input.entries) || input.entries.length > 5) throw new PlannerError("한 번에 기록 5개까지 받을 수 있어요.");
  const seen = new Set<string>(), statements: D1PreparedStatement[] = [], insertionIndexes: number[] = [], taskIndexes: number[] = [], records: Array<{ sourceKey: string; id: string }> = [];
  const now = new Date().toISOString();
  for (const value of input.entries) {
    const item = workObject(value), entry = content(item), sourceKey = workText(item.sourceKey, "원본 기록 ID", 512);
    if (seen.has(sourceKey)) throw new PlannerError("중복된 원본 기록 ID가 있어요.");
    seen.add(sourceKey);
    const existing = (await db.prepare("SELECT id FROM work_entries WHERE owner_id=? AND provider=? AND scope=? AND source_key=?").bind(connection.ownerId, connection.provider, connection.scope, sourceKey).all<{ id: string }>()).results[0];
    if (existing) { records.push({ sourceKey, id: existing.id }); continue; }
    if (item.needsReview !== undefined && typeof item.needsReview !== "boolean") throw new PlannerError("연결 상태를 확인해 주세요.");
    const link = await associations(db, connection.ownerId, { artifactId: item.needsReview ? null : connection.artifactId, stageId: item.stageId, taskId: item.taskId, subtaskId: item.subtaskId });
    const planned = item.plannedTask == null ? null : workObject(item.plannedTask);
    if (planned && (entry.kind !== "plan" || !link.artifactId || link.taskId)) throw new PlannerError("확인된 다음 작업만 새 할 일로 만들 수 있어요.");
    const id = crypto.randomUUID();
    insertionIndexes.push(statements.length);
    statements.push(db.prepare(`INSERT INTO work_entries (id,owner_id,artifact_id,stage_id,task_id,subtask_id,kind,title,body,links,provider,scope,source_key,source_url,occurred_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,provider,scope,source_key) DO NOTHING`)
      .bind(id, connection.ownerId, link.artifactId, link.stageId, link.taskId, link.subtaskId, entry.kind, entry.title, entry.body, JSON.stringify(entry.links), connection.provider, connection.scope, sourceKey, entry.sourceUrl, entry.occurredAt, now));
    if (planned) {
      const taskId = crypto.randomUUID(), date = day(planned.date), end = planned.endDate == null ? null : day(planned.endDate), title = workText(planned.title, "할 일");
      if (end && end < date) throw new PlannerError("할 일 종료일을 확인해 주세요.");
      // A fresh entry ID gates every side effect, including retries after a task was deleted.
      taskIndexes.push(statements.length);
      statements.push(
        db.prepare("INSERT INTO tasks (id,owner_id,date,end_date,title,done,important,created_at,updated_at) SELECT ?,?,?,?,?,0,0,?,? WHERE EXISTS (SELECT 1 FROM work_entries WHERE id=?)").bind(taskId, connection.ownerId, date, end, title, now, now, id),
        db.prepare("INSERT INTO work_task_links (task_id,artifact_id,stage_id) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM work_entries WHERE id=?)").bind(taskId, link.artifactId, link.stageId, id),
        db.prepare("UPDATE work_entries SET task_id=? WHERE id=? AND owner_id=?").bind(taskId, id, connection.ownerId),
      );
    }
  }
  statements.push(db.prepare("UPDATE work_connections SET last_sync_at=? WHERE id=? AND owner_id=?").bind(now, connection.id, connection.ownerId));
  const results = await db.batch(statements);
  const imported = insertionIndexes.reduce((n, index) => n + results[index].meta.changes, 0);
  // Resolve IDs after the batch so simultaneous retries return the winning record.
  for (const sourceKey of seen) if (!records.some(record => record.sourceKey === sourceKey)) {
    const row = (await db.prepare("SELECT id FROM work_entries WHERE owner_id=? AND provider=? AND scope=? AND source_key=?").bind(connection.ownerId, connection.provider, connection.scope, sourceKey).all<{ id: string }>()).results[0];
    records.push({ sourceKey, id: row.id });
  }
  return { imported, duplicate: input.entries.length - imported, tasksCreated: taskIndexes.reduce((n, index) => n + results[index].meta.changes, 0), syncedAt: now, records };
}
