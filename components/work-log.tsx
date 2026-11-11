"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Download, ExternalLink, FileText, FolderOpen, Paperclip, Plus, RefreshCw, Star, X } from "lucide-react";
import type { Task } from "../lib/planner-core";
import { taskHue } from "../lib/planner-core";
import { workKinds, workProviders, workSummaryFields } from "../lib/work-log-types";
import type { WorkArtifact, WorkCatalog, WorkDetail, WorkEntry, WorkStage } from "../lib/work-log-types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const stamp = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value));
const localTime = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const stageLabels = { planned: "예정", active: "진행 중", done: "완료" };
async function api<T>(path = "", input?: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/worklog" + path, input ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : { cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "작업 기록을 불러오지 못했어요.");
  return value as T;
}
function download(name: string, body: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([body], { type })), link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function attach(entryId: string, file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}은 10MB를 넘어요.`);
  const body = new FormData(); body.set("entryId", entryId); body.set("file", file);
  const response = await fetch("/api/worklog/files", { method: "POST", body });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "파일을 올리지 못했어요.");
}

export function WorkLog({ task, onClearTask, onOpenTask }: { task: Task | null; onClearTask: () => void; onOpenTask: (date: string) => void }) {
  const [catalog, setCatalog] = useState<(WorkCatalog & { uploadsAvailable: boolean }) | null>(null);
  const [selected, setSelected] = useState<string | null>(task?.projectId ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const value = await api<WorkCatalog & { uploadsAvailable: boolean }>(); setCatalog(value);
    setSelected(current => current ?? value.artifacts[0]?.id ?? null);
  }, []);
  useEffect(() => { void load().catch(error => setError(error.message)); }, [load]);
  const artifact = catalog?.artifacts.find(item => item.id === selected) ?? null;
  return <section className="work-space" aria-label="작업물과 기록">
    <header className="work-heading"><h2>프로젝트</h2><button className="button primary compact" onClick={() => setCreating(!creating)}><Plus size={14} />프로젝트 추가</button></header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {creating && <form className="card work-form" onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
      try {
        const result = await api<{ id: string }>("", { op: "artifact.add", title: form.get("title"), description: form.get("description"), url: form.get("url"), stages: String(form.get("stages")).split("\n").map(line => line.trim()).filter(Boolean) });
        await load(); setSelected(result.id); setCreating(false);
      } catch (error) { setError(error instanceof Error ? error.message : "저장하지 못했어요."); }
      finally { setBusy(false); }
    }}>
      <label>프로젝트 이름<input name="title" placeholder="예: 배터리 수명 예측 보고서" maxLength={120} required disabled={busy} /></label>
      <label>최종 목표·결과물<textarea name="description" placeholder="이 작업을 마쳤을 때 무엇이 남아야 하나요?" maxLength={2000} rows={2} required disabled={busy} /></label>
      <label>진행 단계<textarea name="stages" placeholder={"자료 조사\n분석\n보고서 작성\n최종 정리"} rows={4} required disabled={busy} /><small>한 줄에 한 단계씩</small></label>
      <label>대표 링크<input name="url" type="url" placeholder="https://" disabled={busy} /></label>
      <div className="work-actions"><button type="button" className="text-button" onClick={() => setCreating(false)}>취소</button><button className="button primary compact" disabled={busy}>만들기</button></div>
    </form>}
    {catalog ? <div className="work-layout">
      <nav className="work-artifacts" aria-label="작업물 선택">
        {catalog.artifacts.map(item => <button key={item.id} className={`task-color ${selected === item.id ? "selected" : ""}`} style={{ "--task-hue": taskHue(item.id) } as CSSProperties} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><FolderOpen size={16} /><span>{item.title}<small>기록 {item.entryCount} · 할 일 {item.taskCount}</small></span></button>)}
        <button className={selected === "" ? "selected" : ""} aria-pressed={selected === ""} onClick={() => setSelected("")}><span>연결 대기<small>{catalog.pending}개</small></span></button>
      </nav>
      {selected !== null ? <WorkDetailView key={selected} artifact={artifact} artifacts={catalog.artifacts} task={task?.projectId === selected ? null : task} onClearTask={onClearTask} onOpenTask={onOpenTask} onSaved={load} uploadsAvailable={catalog.uploadsAvailable} /> : <p className="muted work-empty">프로젝트를 추가해 주세요.</p>}
    </div> : !error && <p className="muted" role="status">작업물 불러오는 중…</p>}
  </section>;
}

function WorkDetailView({ artifact, artifacts, task, onClearTask, onOpenTask, onSaved, uploadsAvailable }: {
  artifact: WorkArtifact | null; artifacts: WorkArtifact[]; task: Task | null; onClearTask: () => void;
  onOpenTask: (date: string) => void; onSaved: () => Promise<void>; uploadsAvailable: boolean;
}) {
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [stage, setStage] = useState("");
  const [view, setView] = useState("flow");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionFile, setConnectionFile] = useState<string | null>(null);
  const sequence = useRef(0);
  const artifactId = artifact?.id ?? "";
  const query = `?artifactId=${encodeURIComponent(artifactId)}&stageId=${encodeURIComponent(view === "flow" ? stage : "")}&view=${view}`;
  const load = useCallback(async () => { const serial = ++sequence.current; const value = await api<WorkDetail>(query); if (serial === sequence.current) setDetail(value); }, [query]);
  useEffect(() => { setDetail(null); void load().catch(error => setError(error.message)); return () => { ++sequence.current; }; }, [load]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden && !busy && !adding && (detail?.entries.length ?? 0) <= 100) void load().catch(error => setError(error.message)); };
    const timer = setInterval(refresh, 30_000); window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [busy, adding, detail?.entries.length, load]);
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setError("");
    try { await action(); await load(); await onSaved(); }
    catch (error) { setError(error instanceof Error ? error.message : "기록을 저장하지 못했어요."); await load().catch(() => {}); }
    finally { setBusy(false); }
  }
  const change = (input: Record<string, unknown>) => run(async () => { await api("", input); });
  async function exportFile(portfolio: boolean) {
    const response = await fetch(`/api/worklog?artifactId=${encodeURIComponent(artifactId)}&export=${portfolio ? "portfolio" : "timeline"}`, { cache: "no-store" });
    if (!response.ok) throw new Error((await response.json()).error);
    download(`${artifact!.title.replace(/[\\/:*?"<>|]/g, "-")}-${portfolio ? "포트폴리오" : "기록"}.md`, await response.text());
  }
  const materials = view === "materials";
  const visible = detail?.entries ?? [];
  const records = <>
    {artifact && <div className="work-actions work-actions-left"><button className="button primary compact" disabled={busy} onClick={() => setAdding(!adding)}><Plus size={14} />{materials ? "자료 추가" : "기록·자료 추가"}</button></div>}
    {adding && artifact && detail && <RecordForm artifactId={artifact.id} stages={detail.stages} stageId={materials ? "" : stage} tasks={detail.tasks} materials={materials} uploadsAvailable={uploadsAvailable} onSaved={async () => { await load(); await onSaved(); }} onClose={() => setAdding(false)} onError={setError} />}
    {detail ? <>
      <div className="work-timeline" aria-label={materials ? "자료 모아보기" : "진행 기록"}>{visible.map(entry => <EntryCard key={entry.id} entry={entry} artifacts={artifacts} detail={detail} materials={materials} busy={busy} uploadsAvailable={uploadsAvailable} onChange={change} run={run} />)}</div>
      {!visible.length && <p className="work-empty muted">{materials ? "파일이나 링크를 추가해 주세요." : artifact ? "이 단계에 기록을 추가해 주세요." : "연결을 기다리는 기록이 없어요."}</p>}
      {detail.nextCursor && <button className="button secondary compact" disabled={busy} onClick={() => { setBusy(true); setError(""); const serial = ++sequence.current; void api<WorkDetail>(`${query}&cursor=${encodeURIComponent(detail.nextCursor!)}`).then(page => { if (serial === sequence.current) setDetail(current => current && ({ ...page, entries: [...current.entries, ...page.entries] })); }).catch(error => setError(error.message)).finally(() => setBusy(false)); }}>{materials ? "이전 자료 더 보기" : "이전 기록 더 보기"}</button>}
    </> : !error && <p role="status" className="muted">{materials ? "자료 불러오는 중…" : "기록 불러오는 중…"}</p>}
  </>;
  return <div className="work-detail" aria-busy={busy}>
    <header className="work-heading"><div><h2>{artifact?.title ?? "연결 대기"}</h2>{artifact?.description && <p className="work-goal">{artifact.description}</p>}{artifact?.url && <a href={artifact.url} target="_blank" rel="noreferrer" className="text-button">대표 결과물<ExternalLink size={12} /></a>}</div><button className="icon-button" disabled={busy} aria-label="기록 새로고침" onClick={() => void run(async () => {})}><RefreshCw size={15} /></button></header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {task && <div className="card work-task-context"><span><strong>{task.title}</strong>의 기록 연결</span>{artifact && <><StageSelect stages={detail?.stages ?? []} value={stage} onChange={setStage} /><button className="button primary compact" disabled={busy || !detail} onClick={() => void run(async () => { await api("", { op: "task.link", taskId: task.id, artifactId, stageId: stage || null }); onClearTask(); })}>여기에 연결</button></>}<button className="icon-button" aria-label="할 일 연결 닫기" onClick={onClearTask}><X size={14} /></button></div>}
    <Tabs value={view} onValueChange={value => { setDetail(null); setView(value); }} className="work-tabs">
      {artifact && <TabsList aria-label="작업물 보기"><TabsTrigger value="flow" disabled={busy || adding}>흐름</TabsTrigger><TabsTrigger value="materials" disabled={busy || adding}>자료</TabsTrigger><TabsTrigger value="summary" disabled={busy || adding}>정리</TabsTrigger></TabsList>}
      <TabsContent value="flow">
    {artifact && detail && <>
      <div className="work-flow-toolbar"><button className="text-button" aria-pressed={!stage} onClick={() => setStage("")}>전체 흐름</button><span className="tiny muted">{detail.stages.filter(item => item.status === "done").length} / {detail.stages.length} 단계 완료</span></div>
      <ol className="work-flow" aria-label="전체 진행 흐름">{detail.stages.map((item, index) => <li key={item.id} className={`${item.status} ${stage === item.id ? "selected" : ""}`}>
        <button aria-pressed={stage === item.id} onClick={() => setStage(stage === item.id ? "" : item.id)}><span className="work-step-number">{index + 1}</span><strong>{item.title}</strong></button>
        <select aria-label={`${item.title} 상태`} value={item.status} disabled={busy} onChange={event => void change({ op: "stage.patch", artifactId, id: item.id, title: item.title, status: event.target.value })}>{Object.entries(stageLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </li>)}</ol>
      <details className="work-settings"><summary>단계 편집</summary>
        {detail.stages.map(item => <form key={item.id} className="work-inline-form" onSubmit={event => { event.preventDefault(); void change({ op: "stage.patch", artifactId, id: item.id, title: new FormData(event.currentTarget).get("title"), status: item.status }); }}><input name="title" aria-label={`${item.title} 이름`} defaultValue={item.title} maxLength={120} required /><button className="text-button" disabled={busy}>이름 저장</button></form>)}
        <form className="work-inline-form" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; void run(async () => { await api("", { op: "stage.add", artifactId, title: new FormData(form).get("title") }); form.reset(); }); }}><input name="title" placeholder="추가할 단계" aria-label="추가할 단계" maxLength={120} required /><button className="text-button" disabled={busy}>단계 추가</button></form>
      </details>
    </>}
    {records}
    {detail && <>
      {!!detail.tasks.length && <details className="work-settings"><summary>연결된 할 일 {detail.tasks.length}</summary><ul className="work-linked-tasks">{detail.tasks.map(item => <li key={item.id}><button className="text-button" onClick={() => onOpenTask(item.date)}><span aria-label={item.done ? "완료" : "할 일"}>{item.done ? "✓" : "□"}</span>{item.title}</button><time>{item.date}</time><button className="text-button" disabled={busy} onClick={() => void change({ op: "task.link", taskId: item.id, artifactId: null })}>연결 해제</button></li>)}</ul></details>}
      {artifact && <details className="work-settings"><summary>GPT·Codex 기록 연결</summary>
        <form className="work-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => {
          const result = await api<{ secret: string; provider: string; scope: string }>("", { op: "connection.add", artifactId, provider: form.get("provider"), scope: form.get("scope") });
          const file = JSON.stringify({ origin: window.location.origin, token: result.secret }, null, 2); setConnectionFile(file); download("daylight-work-connection.json", file, "application/json");
        }); }}>
          <label>앱<select name="provider"><option value="codex">Codex</option><option value="chatgpt">ChatGPT</option></select></label>
          <label>기록을 가져올 곳<input name="scope" placeholder="Codex 프로젝트 폴더 또는 ChatGPT 대화·프로젝트 주소" maxLength={2048} required /></label>
          <button className="button secondary compact" disabled={busy}>연결파일 만들기</button>
          <p className="tiny muted">연결파일을 Codex에 전달해 자동 기록을 설정하세요. 이 작업물의 기록만 연결됩니다.</p>
        </form>
        {connectionFile && <button className="text-button" onClick={() => download("daylight-work-connection.json", connectionFile, "application/json")}>연결파일 다시 다운로드</button>}
        <ul className="work-connections">{detail.connections.map(item => <li key={item.id}><strong>{workProviders[item.provider]}</strong><span>{item.scope}</span><small>{item.revokedAt ? "연결 해제됨" : Date.parse(item.expiresAt) < Date.now() ? "연결 만료" : item.lastSyncAt ? `최근 기록 ${stamp(item.lastSyncAt)}` : "아직 기록을 가져오지 않음"}</small>{!item.revokedAt && <button className="text-button" disabled={busy} onClick={() => void change({ op: "connection.revoke", id: item.id })}>연결 해제</button>}</li>)}</ul>
      </details>}
    </>}
      </TabsContent>
      {artifact && <>
        <TabsContent value="materials">{records}</TabsContent>
        <TabsContent value="summary" forceMount hidden={view !== "summary"}>
          <ProjectSummary artifact={artifact} busy={busy} run={run} />
          <div className="work-actions work-actions-left"><button className="text-button" disabled={busy} onClick={() => void run(() => exportFile(true))}><Star size={13} />포트폴리오 내보내기</button><button className="text-button" disabled={busy} onClick={() => void run(() => exportFile(false))}><Download size={13} />전체 기록 내보내기</button></div>
        </TabsContent>
      </>}
    </Tabs>
  </div>;
}

function ProjectSummary({ artifact, busy, run }: { artifact: WorkArtifact; busy: boolean; run: (action: () => Promise<void>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  return editing ? <form className="card work-form work-summary-form" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void run(async () => { await api("", { op: "artifact.patch", id: artifact.id, ...Object.fromEntries(form) }); setEditing(false); });
  }}>
    <fieldset disabled={busy}>
      <label>작업물 이름<input name="title" defaultValue={artifact.title} maxLength={120} required /></label>
      <label>목표<textarea name="description" defaultValue={artifact.description} maxLength={2000} rows={2} /></label>
      {workSummaryFields.map(field => <label key={field.key}>{field.label}<textarea name={field.key} defaultValue={artifact[field.key]} placeholder={field.placeholder} maxLength={4000} rows={3} /></label>)}
      <label>대표 결과물 링크<input name="url" type="url" defaultValue={artifact.url ?? ""} placeholder="https://" /></label>
    </fieldset>
    <div className="work-actions"><button type="button" className="text-button" disabled={busy} onClick={() => setEditing(false)}>취소</button><button className="button primary compact" disabled={busy}>정리 저장</button></div>
  </form> : <>
    <div className="work-actions work-actions-left"><button className="button secondary compact" disabled={busy} onClick={() => setEditing(true)}>정리 편집</button></div>
    <div className="work-summary">{workSummaryFields.filter(field => artifact[field.key]).map(field => <section className="card" key={field.key}><h3>{field.label}</h3><p>{artifact[field.key]}</p></section>)}</div>
  </>;
}

function StageSelect({ stages, value, onChange, name }: { stages: WorkStage[]; value?: string; onChange?: (value: string) => void; name?: string }) {
  return <select name={name} value={value} onChange={event => onChange?.(event.target.value)} aria-label="진행 단계"><option value="">단계 미지정</option>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select>;
}

function RecordForm({ artifactId, stages, stageId, tasks, materials, uploadsAvailable, onSaved, onClose, onError }: {
  artifactId: string; stages: WorkStage[]; stageId: string; tasks: WorkDetail["tasks"]; materials: boolean; uploadsAvailable: boolean;
  onSaved: () => Promise<void>; onClose: () => void; onError: (error: string) => void;
}) {
  const [selectedStage, setSelectedStage] = useState(stageId), [files, setFiles] = useState<File[]>([]), [createdId, setCreatedId] = useState<string | null>(null), [saving, setSaving] = useState(false);
  return <form className="card work-form" onSubmit={async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); onError("");
    let id = createdId;
    try {
      if (!id) {
        const href = String(form.get("url") || "").trim();
        if (materials && !href && !files.length) throw new Error("파일이나 링크를 추가해 주세요.");
        const result = await api<{ id: string }>("", { op: "entry.add", artifactId, stageId: selectedStage || null, taskId: form.get("taskId") || null, kind: materials ? "progress" : form.get("kind"), title: form.get("title"), body: form.get("body"), occurredAt: new Date(String(form.get("time") || localTime())).toISOString(), links: href ? [{ label: String(form.get("linkLabel") || "자료 링크"), url: href }] : [] });
        id = result.id; setCreatedId(id);
      }
      for (const file of files) { await attach(id, file); setFiles(current => current.filter(item => item !== file)); }
      await onSaved(); onClose();
    } catch (error) { onError(`${id ? "기록은 저장됐어요. 남은 파일을 다시 올려 주세요. " : ""}${error instanceof Error ? error.message : "저장하지 못했어요."}`); await onSaved().catch(() => {}); }
    finally { setSaving(false); }
  }}>
    <fieldset disabled={saving || Boolean(createdId)}>
      <div className="work-form-row"><label>단계<StageSelect stages={stages} value={selectedStage} onChange={setSelectedStage} /></label>{!materials && <><label>종류<select name="kind" defaultValue="progress">{Object.entries(workKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>작업 시각<input type="datetime-local" name="time" defaultValue={localTime()} required /></label></>}</div>
      <label>{materials ? "자료 이름" : "기록 제목"}<input name="title" placeholder={materials ? "보고서·참고 자료 이름" : "무엇을 했나요?"} maxLength={240} required /></label>
      <label>{materials ? "활용 메모" : "내용"}<textarea name="body" placeholder={materials ? "어디에 쓰는 자료인가요?" : "진행한 내용, 결정한 이유, 남은 일"} maxLength={8000} rows={materials ? 2 : 4} /></label>
      <label>관련 할 일<select name="taskId"><option value="">작업물에만 기록</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      <div className="work-form-row"><label>자료 링크<input name="url" type="url" placeholder="https://" /></label><label>링크 이름<input name="linkLabel" maxLength={200} placeholder="보고서·문서" /></label></div>
    </fieldset>
    <label>보고서·이미지<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp" disabled={saving || !uploadsAvailable} onChange={event => setFiles(current => [...current, ...Array.from(event.target.files ?? [])])} /><small>{uploadsAvailable ? "파일당 10MB · 전체 첨부 저장 공간 200MB · PDF, PNG, JPG, GIF, WebP" : "파일을 첨부할 수 없어요."}</small></label>
    {!!files.length && <ul className="work-file-queue">{files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name}<button type="button" className="icon-button" aria-label={`${file.name} 첨부 취소`} disabled={saving} onClick={() => setFiles(current => current.filter((_, i) => i !== index))}><X size={12} /></button></li>)}</ul>}
    <div className="work-actions"><button type="button" className="text-button" disabled={saving} onClick={onClose}>닫기</button><button className="button primary compact" disabled={saving}>{saving ? "저장 중…" : createdId ? "남은 파일 올리기" : materials ? "자료 저장" : "기록 저장"}</button></div>
  </form>;
}

function EntryCard({ entry, artifacts, detail, materials, busy, uploadsAvailable, onChange, run }: { entry: WorkEntry; artifacts: WorkArtifact[]; detail: WorkDetail; materials: boolean; busy: boolean; uploadsAvailable: boolean; onChange: (input: Record<string, unknown>) => Promise<void>; run: (action: () => Promise<void>) => Promise<void> }) {
  const [editing, setEditing] = useState(false), [target, setTarget] = useState(entry.artifactId ?? "");
  return <article className="card work-entry">
    <div className="work-entry-meta"><time dateTime={entry.occurredAt}>{stamp(entry.occurredAt)}</time><span>{entry.stageTitle || "단계 미지정"}</span>{!materials && <><span>{workKinds[entry.kind]}</span><span>{workProviders[entry.provider]}</span></>}<button className={`icon-button ${entry.featured ? "starred" : ""}`} aria-label="포트폴리오에 포함" aria-pressed={Boolean(entry.featured)} disabled={busy} onClick={() => void onChange({ op: "entry.patch", id: entry.id, featured: !entry.featured })}><Star size={14} /></button></div>
    {editing ? <form className="work-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await api("", { op: "entry.patch", id: entry.id, title: form.get("title"), body: form.get("body") }); setEditing(false); }); }}><label>{materials ? "자료 이름" : "기록 제목"}<input name="title" defaultValue={entry.title} maxLength={240} required /></label><label>{materials ? "활용 메모" : "내용"}<textarea name="body" defaultValue={entry.body} maxLength={8000} rows={4} /></label><div className="work-actions"><button type="button" className="text-button" onClick={() => setEditing(false)}>취소</button><button className="button secondary compact" disabled={busy}>저장</button></div></form> : <><h3>{entry.title}</h3>{entry.body && (materials ? <details className="work-material-note"><summary>활용 메모</summary><p className="work-entry-body">{entry.body}</p></details> : <p className="work-entry-body">{entry.body}</p>)}</>}
    {entry.taskTitle && <p className="work-entry-task">{entry.taskTitle}{entry.subtaskTitle ? ` / ${entry.subtaskTitle}` : ""}</p>}
    {!!entry.links.length && <ul className="work-links">{entry.links.map((link, i) => <li key={i}><a href={link.url} target="_blank" rel="noreferrer"><ExternalLink size={13} />{link.label}</a></li>)}</ul>}
    {!!entry.files.length && <ul className="work-files">{entry.files.map(file => <li key={file.id}>
      <a href={`/api/worklog/files/${file.id}`} target="_blank" rel="noreferrer">{file.contentType.startsWith("image/") ? <img src={`/api/worklog/files/${file.id}?preview=1`} alt={file.fileName} loading="lazy" /> : <FileText size={28} />}<span>{file.fileName}<small>{(file.size / 1024).toFixed(0)} KB · {stamp(file.createdAt)}</small></span><Download size={13} /></a>
      <button className="icon-button" aria-label={`${file.fileName} 삭제`} disabled={busy} onClick={() => void run(async () => { const response = await fetch(`/api/worklog/files/${file.id}`, { method: "DELETE" }); if (!response.ok) throw new Error((await response.json()).error); })}><X size={12} /></button>
    </li>)}</ul>}
    <details className={materials ? "work-material-edit" : "work-entry-tools"} open={!materials}><summary>자료 편집</summary>
    <div className="work-entry-actions">{entry.sourceUrl && <a className="text-button" href={entry.sourceUrl} target="_blank" rel="noreferrer">원문<ExternalLink size={11} /></a>}<button className="text-button" disabled={busy} onClick={() => setEditing(!editing)}>{materials ? "이름·메모 수정" : "기록 수정"}</button>
      {uploadsAvailable && <label className="text-button work-upload-button"><Paperclip size={12} />자료 추가<input type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp" multiple disabled={busy} aria-label={`${entry.title} 자료 첨부`} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void run(async () => { for (const file of files) await attach(entry.id, file); }); }} /></label>}
      <button className="text-button" disabled={busy} onClick={() => void onChange({ op: "entry.patch", id: entry.id, hidden: true })}>숨기기</button>
    </div>
    <details className="work-reassign"><summary>작업물·단계·할 일 연결</summary><form className="work-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void onChange({ op: "entry.patch", id: entry.id, artifactId: target || null, stageId: target === entry.artifactId ? form.get("stageId") || null : null, taskId: target === entry.artifactId ? form.get("taskId") || null : null, subtaskId: null }); }}>
      <select aria-label="기록을 연결할 작업물" value={target} onChange={event => setTarget(event.target.value)}><option value="">연결 대기</option>{artifacts.map(artifact => <option key={artifact.id} value={artifact.id}>{artifact.title}</option>)}</select>
      {target === entry.artifactId && <><select name="stageId" aria-label="기록 단계" defaultValue={entry.stageId ?? ""}><option value="">단계 미지정</option>{detail.stages.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select name="taskId" aria-label="관련 할 일" defaultValue={entry.taskId ?? ""}><option value="">작업물에만 기록</option>{detail.tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></>}
      <button className="button secondary compact" disabled={busy}>연결 저장</button>
    </form></details>
    </details>
  </article>;
}
