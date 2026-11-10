export type WorkKind = "plan" | "decision" | "progress" | "result";
export type WorkProvider = "manual" | "daylight" | "codex" | "chatgpt";
export type WorkLink = { label: string; url: string };
export type WorkArtifact = { id: string; title: string; description: string; url: string | null; updatedAt: string; entryCount: number; taskCount: number };
export type WorkStage = { id: string; title: string; position: number; status: "planned" | "active" | "done" };
export type WorkFile = { id: string; entryId: string; fileName: string; contentType: string; size: number; createdAt: string };
export type WorkEntry = {
  id: string; artifactId: string | null; stageId: string | null; taskId: string | null; subtaskId: string | null;
  kind: WorkKind; title: string; body: string; links: WorkLink[]; provider: WorkProvider;
  sourceKey: string; sourceUrl: string | null; occurredAt: string; featured: number;
  taskTitle: string | null; subtaskTitle: string | null; stageTitle: string | null; files: WorkFile[];
};
export type WorkTask = { id: string; title: string; date: string; endDate: string | null; done: number; stageId: string | null; subtasks: Array<{ id: string; title: string; date: string; done: number }> };
export type WorkConnection = { id: string; artifactId: string; provider: "codex" | "chatgpt"; scope: string; expiresAt: string; lastSyncAt: string | null; revokedAt: string | null };
export type WorkCatalog = { artifacts: WorkArtifact[]; pending: number };
export type WorkDetail = { stages: WorkStage[]; entries: WorkEntry[]; nextCursor: string | null; tasks: WorkTask[]; connections: WorkConnection[] };
export const workKinds: Record<WorkKind, string> = { plan: "할 예정", decision: "결정", progress: "진행", result: "결과" };
export const workProviders: Record<WorkProvider, string> = { manual: "직접 기록", daylight: "daylight", codex: "Codex", chatgpt: "ChatGPT" };

const escapeMarkdown = (value: string) => value.replace(/[\\`*_{}\[\]<>#]/g, "\\$&");
export function workMarkdown(artifact: WorkArtifact, entries: WorkEntry[], stages: WorkStage[], origin: string, portfolio = false) {
  const chosen = entries.filter(entry => !portfolio || entry.featured).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  return [`# ${escapeMarkdown(artifact.title)}`, artifact.description, artifact.url ? `<${artifact.url}>` : "",
    stages.length ? `## 진행 흐름\n\n${stages.map(stage => `- [${stage.status === "done" ? "x" : " "}] ${escapeMarkdown(stage.title)}${stage.status === "active" ? " · 진행 중" : ""}`).join("\n")}` : "",
    ...chosen.map(entry => [
      `## ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(entry.occurredAt))} · ${escapeMarkdown(entry.title)}`,
      [entry.stageTitle, workKinds[entry.kind], workProviders[entry.provider]].filter(Boolean).join(" · "),
      entry.body,
      ...entry.links.map(link => `- [${escapeMarkdown(link.label)}](<${link.url}>)`),
      ...entry.files.map(file => `- [${escapeMarkdown(file.fileName)}](<${origin}/api/worklog/files/${file.id}>)`),
      entry.sourceUrl ? `[대화·근거 보기](<${entry.sourceUrl}>)` : "",
    ].filter(Boolean).join("\n\n")),
  ].filter(Boolean).join("\n\n") + "\n";
}
