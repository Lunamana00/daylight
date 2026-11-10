import { Buffer } from "node:buffer";
import { PlannerError } from "./planner-core";
import { workText } from "./work-log";
import type { CollectorConnection } from "./work-log";
import type { WorkFile } from "./work-log-types";

export const maxWorkFileSize = 10 * 1024 * 1024;
// Reserve most of the free database for planner records and future entries.
export const maxWorkStorageSize = 200 * 1024 * 1024;
const chunkSize = 512 * 1024;
export function workFileType(bytes: Uint8Array) {
  const text = new TextDecoder("ascii").decode(bytes.slice(0, 12));
  if (text.startsWith("%PDF-")) return "application/pdf";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (text.startsWith("GIF87a") || text.startsWith("GIF89a")) return "image/gif";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  throw new PlannerError("PDF, PNG, JPG, GIF, WebP 파일을 올려 주세요.");
}
export async function fileEntry(db: D1Database, ownerId: string, entryId: unknown, connection?: CollectorConnection | null) {
  const id = workText(entryId, "첨부할 기록", 100);
  const entry = (await db.prepare("SELECT id,artifact_id AS artifactId,provider,scope FROM work_entries WHERE id=? AND owner_id=? AND hidden=0").bind(id, ownerId).all<{ id: string; artifactId: string | null; provider: string; scope: string }>()).results[0];
  if (!entry || (connection && (entry.provider !== connection.provider || entry.scope !== connection.scope || (entry.artifactId !== null && entry.artifactId !== connection.artifactId)))) throw new PlannerError("첨부할 기록을 찾을 수 없어요.", 404);
  return entry;
}
export async function uploadWorkFile(db: D1Database, ownerId: string, entryId: string, name: string, bytes: Uint8Array, connection?: CollectorConnection | null): Promise<WorkFile> {
  await fileEntry(db, ownerId, entryId, connection);
  if (!bytes.length || bytes.length > maxWorkFileSize) throw new PlannerError("파일은 10MB까지 올릴 수 있어요.", 413);
  const contentType = workFileType(bytes), fileName = workText(name, "파일 이름", 240);
  if (/[\x00-\x1f\x7f]/.test(fileName)) throw new PlannerError("파일 이름을 확인해 주세요.");
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), byte => byte.toString(16).padStart(2, "0")).join("");
  const existing = () => db.prepare("SELECT id,entry_id AS entryId,file_name AS fileName,content_type AS contentType,size,created_at AS createdAt FROM work_files WHERE entry_id=? AND checksum=? AND owner_id=?").bind(entryId, checksum, ownerId).all<WorkFile>();
  const saved = (await existing()).results[0];
  if (saved) return saved;
  const id = crypto.randomUUID(), objectKey = `db:${id}`, createdAt = new Date().toISOString();
  const statements = [db.prepare("INSERT INTO work_files (id,owner_id,entry_id,object_key,checksum,file_name,content_type,size,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM work_entries WHERE id=? AND owner_id=? AND hidden=0) AND (SELECT count(*) FROM work_files WHERE entry_id=?)<20 AND (SELECT COALESCE(sum(size),0) FROM work_files WHERE object_key LIKE 'db:%')+?<=? ON CONFLICT(entry_id,checksum) DO NOTHING")
    .bind(id, ownerId, entryId, objectKey, checksum, fileName, contentType, bytes.length, createdAt, entryId, ownerId, entryId, bytes.length, maxWorkStorageSize)];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    statements.push(db.prepare("INSERT INTO work_file_chunks (file_id,position,content) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM work_files WHERE id=? AND owner_id=?)")
      .bind(id, offset / chunkSize, bytes.slice(offset, offset + chunkSize).buffer, id, ownerId));
  }
  const [result] = await db.batch(statements);
  if (!result.meta.changes) {
    const duplicate = (await existing()).results[0];
    if (duplicate) return duplicate;
    const usage = (await db.prepare("SELECT COALESCE(sum(size),0) AS used FROM work_files WHERE object_key LIKE 'db:%'").all<{ used: number }>()).results[0].used;
    if (usage + bytes.length > maxWorkStorageSize) throw new PlannerError("첨부파일 저장 공간 200MB가 가득 찼어요. 기존 파일을 내려받아 정리하거나 자료 링크를 추가해 주세요. 추가 요금은 청구되지 않아요.", 413);
    throw new PlannerError("기록당 첨부는 20개까지 가능해요. 기록 상태를 다시 확인해 주세요.", 409);
  }
  return { id, entryId, fileName, contentType, size: bytes.length, createdAt };
}
export async function ownedWorkFile(db: D1Database, ownerId: string, id: unknown, connection?: CollectorConnection | null) {
  const file = (await db.prepare("SELECT id,entry_id AS entryId,object_key AS objectKey,file_name AS fileName,content_type AS contentType,size,created_at AS createdAt FROM work_files WHERE id=? AND owner_id=?").bind(workText(id, "파일", 100), ownerId).all<WorkFile & { objectKey: string }>()).results[0];
  if (!file) throw new PlannerError("파일을 찾을 수 없어요.", 404);
  await fileEntry(db, ownerId, file.entryId, connection);
  return file;
}
export async function readWorkFile(db: D1Database, file: WorkFile & { objectKey: string }, bucket?: R2Bucket) {
  if (!file.objectKey.startsWith("db:")) {
    const object = await bucket?.get(file.objectKey);
    if (!object) throw new PlannerError("파일을 찾을 수 없어요.", 404);
    return object.body;
  }
  // Hex avoids expanding each stored byte into a JSON number during download.
  const chunks = (await db.prepare("SELECT position,hex(content) AS content FROM work_file_chunks WHERE file_id=? ORDER BY position").bind(file.id).all<{ position: number; content: string }>()).results;
  const bytes = new Uint8Array(file.size); let offset = 0;
  for (const [position, chunk] of chunks.entries()) {
    const data = Buffer.from(chunk.content, "hex");
    if (chunk.position !== position || offset + data.length > bytes.length) throw new PlannerError("파일 내용을 읽지 못했어요.", 500);
    bytes.set(data, offset); offset += data.length;
  }
  if (offset !== bytes.length) throw new PlannerError("파일 내용을 읽지 못했어요.", 500);
  return bytes;
}
