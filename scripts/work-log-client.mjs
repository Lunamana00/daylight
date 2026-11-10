import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

// The agent reads the selected chats; this client only sends the resulting records and chosen reports.
try {
  const [command, configPath, entryId, filePath] = process.argv.slice(2);
  if (!['context', 'import', 'upload'].includes(command) || !configPath) throw new Error('Use: node scripts/work-log-client.mjs context|import|upload CONNECTION_FILE [ENTRY_ID REPORT_FILE]');
  if ((await stat(configPath)).size > 16_384) throw new Error('Connection file is too large.');
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch { throw new Error('Cannot read the connection file.'); }
  const origin = new URL(config.origin);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !/^dwl_[a-f0-9]{64}$/.test(config.token)) throw new Error('Invalid connection file.');
  const headers = { Authorization: `Bearer ${config.token}` };
  let path = '/api/worklog/ingest', body, method = 'GET';
  if (command === 'import') {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 600_000) throw new Error('Import is too large.'); chunks.push(chunk); }
    body = Buffer.concat(chunks).toString('utf8');
    try { const value = JSON.parse(body); if (!value || !Array.isArray(value.entries) || value.entries.length > 5) throw new Error(); }
    catch { throw new Error('Pass a JSON object with up to 5 entries on stdin.'); }
    method = 'POST'; headers['Content-Type'] = 'application/json';
  }
  if (command === 'upload') {
    if (!entryId || !filePath) throw new Error('An entry ID and a report file are required.');
    const info = await stat(filePath);
    if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('Reports must be files of at most 10 MB.');
    body = new FormData(); body.set('entryId', entryId); body.set('file', new Blob([await readFile(filePath)]), basename(filePath));
    path = '/api/worklog/files'; method = 'POST';
  }
  const response = await fetch(new URL(path, origin), { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  let result;
  try { result = await response.json(); } catch { throw new Error(`Server returned HTTP ${response.status}.`); }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Server returned HTTP ${response.status}.`);
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'Work log request failed.') + '\n');
  process.exitCode = 1;
}
