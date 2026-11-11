import { Buffer } from "node:buffer";
import { PlannerError } from "./planner-core";
import { ownedArtifact, workText } from "./work-log";
import { readWorkFile } from "./work-files";
import { workMarkdown } from "./work-log-types";
import type { WorkEntry, WorkFile, WorkGithubState, WorkGithubVersion, WorkStage } from "./work-log-types";

type Connection = { artifactId: string; ownerId: string; repositoryId: number; repository: string; branch: string; tokenCipher: string };
type Repository = { id: number; full_name: string; private: boolean; archived: boolean; disabled: boolean; default_branch: string; owner: { login: string }; permissions?: { push?: boolean } };
type StoredFile = WorkFile & { objectKey: string; checksum: string };
const encoder = new TextEncoder();
const versionSelect = "SELECT id,entry_id AS entryId,repository,commit_sha AS commitSha,path,digest,saved_at AS savedAt FROM work_github_versions";

export function githubRepository(value: unknown) {
  let name = workText(value, "GitHub 저장소", 300);
  if (name.startsWith("https://")) {
    const url = new URL(name);
    if (url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) throw new PlannerError("github.com의 저장소 주소를 입력해 주세요.");
    name = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  name = name.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(name) || [".", ".."].includes(name.split("/")[1])) throw new PlannerError("저장소를 계정/이름 형식으로 입력해 주세요.");
  return name;
}

async function request<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "daylight-work-records", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new PlannerError("GitHub에 연결하지 못했어요. 입력한 기록은 daylight에 남아 있어요.", 502); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403 || response.status === 404) throw new PlannerError("GitHub 연결 권한·만료일을 확인해 주세요. 선택한 저장소에 Contents 읽기·쓰기 권한이 필요해요.", 403);
    if (response.status === 409 || response.status === 422) throw new PlannerError("GitHub 저장소가 변경됐거나 저장이 제한됐어요. README가 있는 저장소인지 확인하고 다시 저장해 주세요.", 409);
    throw new PlannerError("GitHub 저장에 실패했어요. 입력한 기록은 daylight에 남아 있어요.", 502);
  }
  return await response.json() as T;
}

async function key(secret?: string) {
  if (!secret || secret.length < 32) throw new PlannerError("GitHub 연결 준비가 필요해요.", 503);
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", encoder.encode(secret)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
const binding = (ownerId: string, artifactId: string, repositoryId: number) => encoder.encode(`daylight/github/v1:${ownerId}:${artifactId}:${repositoryId}`);
async function seal(token: string, ownerId: string, artifactId: string, repositoryId: number, secret?: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: binding(ownerId, artifactId, repositoryId) }, await key(secret), encoder.encode(token));
  return `${Buffer.from(iv).toString("base64url")}.${Buffer.from(bytes).toString("base64url")}`;
}
async function unseal(connection: Connection, secret?: string) {
  const encryptionKey = await key(secret);
  try {
    const [iv, bytes] = connection.tokenCipher.split(".");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64url"), additionalData: binding(connection.ownerId, connection.artifactId, connection.repositoryId) }, encryptionKey, Buffer.from(bytes, "base64url"));
    return new TextDecoder().decode(plain);
  } catch { throw new PlannerError("GitHub를 다시 연결해 주세요.", 403); }
}
function privateRepository(repo: Repository) {
  if (!repo.private) throw new PlannerError("개인 작업 기록은 비공개 GitHub 저장소에만 저장할 수 있어요.", 403);
  if (repo.archived || repo.disabled || !repo.permissions?.push) throw new PlannerError("이 저장소에는 기록을 저장할 수 없어요. 쓰기 권한과 저장소 상태를 확인해 주세요.", 403);
}

export async function connectWorkGithub(db: D1Database, ownerId: string, input: Record<string, unknown>, secret?: string) {
  const artifact = await ownedArtifact(db, ownerId, input.artifactId);
  const repository = githubRepository(input.repository), token = workText(input.token, "GitHub 연결 토큰", 512);
  if (!/^github_pat_[A-Za-z0-9_]{40,240}$/.test(token)) throw new PlannerError("선택한 저장소만 허용한 fine-grained 토큰을 입력해 주세요.");
  const user = await request<{ login: string }>(token, "/user");
  const repo = await request<Repository>(token, `/repos/${repository}`);
  privateRepository(repo);
  if (user.login.toLowerCase() !== repo.owner.login.toLowerCase()) throw new PlannerError("본인 계정이 소유한 비공개 저장소를 연결해 주세요.", 403);
  // Resolve the existing branch before saving the connection; never initialize or replace a user's branch.
  await request(token, `/repos/${repository}/branches/${encodeURIComponent(repo.default_branch)}`);
  const tokenCipher = await seal(token, ownerId, artifact.id, repo.id, secret);
  await db.prepare(`INSERT INTO work_github_connections (artifact_id,owner_id,repository_id,repository,branch,token_cipher,connected_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(artifact_id) DO UPDATE SET repository_id=excluded.repository_id,repository=excluded.repository,branch=excluded.branch,token_cipher=excluded.token_cipher,connected_at=excluded.connected_at WHERE work_github_connections.owner_id=excluded.owner_id`)
    .bind(artifact.id, ownerId, repo.id, repo.full_name, repo.default_branch, tokenCipher, new Date().toISOString()).run();
  return { connected: true, repository: repo.full_name };
}

export async function workGithubState(db: D1Database, ownerId: string, artifactId: string): Promise<WorkGithubState> {
  await ownedArtifact(db, ownerId, artifactId);
  const connection = (await db.prepare("SELECT repository,branch,connected_at AS connectedAt FROM work_github_connections WHERE owner_id=? AND artifact_id=?").bind(ownerId, artifactId).all<WorkGithubState["connection"]>()).results[0] ?? null;
  const versions = (await db.prepare(`${versionSelect} WHERE owner_id=? AND entry_id IN (SELECT id FROM work_entries WHERE owner_id=? AND artifact_id=?) ORDER BY saved_at DESC,id DESC LIMIT 500`)
    .bind(ownerId, ownerId, artifactId).all<WorkGithubVersion>()).results;
  return { connection, versions };
}

export async function disconnectWorkGithub(db: D1Database, ownerId: string, artifactId: unknown) {
  const artifact = await ownedArtifact(db, ownerId, artifactId);
  await db.prepare("DELETE FROM work_github_connections WHERE owner_id=? AND artifact_id=?").bind(ownerId, artifact.id).run();
  return { disconnected: true };
}

export async function saveWorkGithub(db: D1Database, ownerId: string, entryId: unknown, secret?: string, bucket?: R2Bucket) {
  const entry = (await db.prepare(`SELECT e.id,e.artifact_id AS artifactId,e.stage_id AS stageId,e.task_id AS taskId,e.subtask_id AS subtaskId,
    e.kind,e.title,e.body,e.links,e.provider,e.source_key AS sourceKey,e.source_url AS sourceUrl,e.occurred_at AS occurredAt,e.featured,
    t.title AS taskTitle,s.title AS subtaskTitle,g.title AS stageTitle
    FROM work_entries e LEFT JOIN tasks t ON t.id=e.task_id AND t.owner_id=e.owner_id
    LEFT JOIN task_subtasks s ON s.id=e.subtask_id AND s.task_id=t.id LEFT JOIN work_stages g ON g.id=e.stage_id AND g.artifact_id=e.artifact_id
    WHERE e.id=? AND e.owner_id=? AND e.hidden=0`).bind(workText(entryId, "기록", 100), ownerId).all<Omit<WorkEntry, "links" | "files"> & { links: string }>()).results[0];
  if (!entry || !entry.artifactId) throw new PlannerError("프로젝트에 연결된 본인의 기록을 선택해 주세요.", 404);
  if (entry.provider !== "manual") throw new PlannerError("직접 작성한 기록만 GitHub에 저장할 수 있어요.");
  const artifact = await ownedArtifact(db, ownerId, entry.artifactId);
  const connection = (await db.prepare("SELECT artifact_id AS artifactId,owner_id AS ownerId,repository_id AS repositoryId,repository,branch,token_cipher AS tokenCipher FROM work_github_connections WHERE owner_id=? AND artifact_id=?")
    .bind(ownerId, artifact.id).all<Connection>()).results[0];
  if (!connection) throw new PlannerError("먼저 이 프로젝트의 GitHub 저장소를 연결해 주세요.", 409);
  const token = await unseal(connection, secret);
  const repo = await request<Repository>(token, `/repos/${connection.repository}`);
  privateRepository(repo);
  if (repo.id !== connection.repositoryId || repo.full_name.toLowerCase() !== connection.repository.toLowerCase()) throw new PlannerError("저장소가 변경됐어요. GitHub를 다시 연결해 주세요.", 409);
  const files = (await db.prepare("SELECT id,entry_id AS entryId,object_key AS objectKey,checksum,file_name AS fileName,content_type AS contentType,size,created_at AS createdAt FROM work_files WHERE owner_id=? AND entry_id=? ORDER BY created_at,id")
    .bind(ownerId, entry.id).all<StoredFile>()).results;
  const stages = (await db.prepare("SELECT id,title,position,status FROM work_stages WHERE artifact_id=? ORDER BY position,id").bind(artifact.id).all<WorkStage>()).results;
  const attachmentPath = (file: WorkFile) => `files/${file.id}-${file.fileName.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^\.+/, "") || "file"}`;
  const record: WorkEntry = { ...entry, links: JSON.parse(entry.links), files: files.map(({ objectKey: _key, checksum: _checksum, ...file }) => file) };
  const document = {
    format: "daylight-work-record-v1", project: { id: artifact.id, title: artifact.title, description: artifact.description, background: artifact.background, contribution: artifact.contribution, decisions: artifact.decisions, results: artifact.results, reflection: artifact.reflection, url: artifact.url },
    stages, record, attachments: files.map(file => ({ id: file.id, path: attachmentPath(file), checksum: file.checksum })),
  };
  const json = JSON.stringify(document, null, 2) + "\n";
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", encoder.encode(json))).toString("hex");
  const saved = (await db.prepare(`${versionSelect} WHERE owner_id=? AND entry_id=? AND repository_id=? AND digest=?`).bind(ownerId, entry.id, repo.id, digest).all<WorkGithubVersion>()).results[0];
  if (saved) return { version: saved, unchanged: true };
  const path = `daylight/${artifact.id}/${entry.id}/${digest}`;
  const markdown = workMarkdown(artifact, [record], stages, "", false, file => "./" + attachmentPath(file).split("/").map(encodeURIComponent).join("/"));
  const tree: Array<{ path: string; mode: "100644"; type: "blob"; content?: string; sha?: string }> = [
    { path: `${path}/README.md`, mode: "100644", type: "blob", content: markdown },
    { path: `${path}/record.json`, mode: "100644", type: "blob", content: json },
  ];
  for (const file of files) {
    const body = await readWorkFile(db, file, bucket);
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
    if (bytes.length !== file.size || Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex") !== file.checksum) throw new PlannerError("첨부파일이 변경됐어요. 기록을 새로고침하고 다시 저장해 주세요.", 409);
    const blob = await request<{ sha: string }>(token, `/repos/${connection.repository}/git/blobs`, "POST", { content: Buffer.from(bytes).toString("base64"), encoding: "base64" });
    tree.push({ path: `${path}/${attachmentPath(file)}`, mode: "100644", type: "blob", sha: blob.sha });
  }
  const branch = await request<{ commit: { sha: string; commit: { tree: { sha: string } } } }>(token, `/repos/${connection.repository}/branches/${encodeURIComponent(connection.branch)}`);
  const nextTree = await request<{ sha: string }>(token, `/repos/${connection.repository}/git/trees`, "POST", { base_tree: branch.commit.commit.tree.sha, tree });
  let commitSha = branch.commit.sha;
  if (nextTree.sha !== branch.commit.commit.tree.sha) {
    const commit = await request<{ sha: string }>(token, `/repos/${connection.repository}/git/commits`, "POST", { message: `daylight: ${artifact.title} / ${entry.title}`, tree: nextTree.sha, parents: [branch.commit.sha] });
    await request(token, `/repos/${connection.repository}/git/refs/heads/${connection.branch.split("/").map(encodeURIComponent).join("/")}`, "PATCH", { sha: commit.sha, force: false });
    commitSha = commit.sha;
  }
  // Content-addressed directories preserve prior versions and make retries after a lost response safe.
  const id = crypto.randomUUID(), savedAt = new Date().toISOString();
  await db.prepare("INSERT INTO work_github_versions (id,owner_id,entry_id,repository_id,repository,commit_sha,path,digest,saved_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(entry_id,repository_id,digest) DO NOTHING")
    .bind(id, ownerId, entry.id, repo.id, connection.repository, commitSha, path, digest, savedAt).run();
  const version = (await db.prepare(`${versionSelect} WHERE owner_id=? AND entry_id=? AND repository_id=? AND digest=?`).bind(ownerId, entry.id, repo.id, digest).all<WorkGithubVersion>()).results[0];
  return { version, unchanged: false };
}
