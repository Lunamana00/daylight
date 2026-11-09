import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import ts from 'typescript';

function moduleURL(path, imports = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
const coreURL = moduleURL('../lib/planner-core.ts');
const calendarURL = moduleURL('../lib/google-calendar.ts', { './planner-core': coreURL });
const { change, readDay, syncMilestones, today } = await import(coreURL);
const { handleGoogleAuth, readCalendarGrant, syncSavedGoogleCalendars, calendarSyncStatus, handleInvitations, getGoogleSession } = await import(moduleURL('../lib/google-auth.ts', {
  './planner-core': coreURL, './google-calendar': calendarURL,
}));
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
  sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
}
for (const file of ['google-auth.sql', 'google-calendar.sql', 'google-calendar-auto.sql', 'google-invites.sql']) {
  sqlite.exec(readFileSync(new URL('../deploy/' + file, import.meta.url), 'utf8'));
}
sqlite.exec(`INSERT INTO members VALUES ('migration', 'Saved member', 'saved@example.test', '2026-01-01');
  INSERT INTO calendar_sources VALUES ('migration', 'saved@example.test', 'Saved calendar', '2026-01-01');
  INSERT INTO milestones VALUES ('migration', 'saved@example.test', 'saved-event', 'Saved event', '2026-01-01', NULL, '2026-01-01');
  INSERT INTO milestone_order VALUES ('saved@example.test', 'saved-event', 7);
  INSERT INTO daylight_google_calendar_connections (calendar_id,owner_id,google_sub,email,refresh_token) VALUES ('saved@example.test', 'migration', 'saved-subject', 'saved@example.test', 'encrypted-value')`);
const beforeMigration = ['calendar_sources', 'milestones', 'milestone_order', 'daylight_google_calendar_connections'].map(table => sqlite.prepare('SELECT * FROM ' + table).all());
sqlite.exec(readFileSync(new URL('../deploy/google-calendar-personal.sql', import.meta.url), 'utf8'));
assert.deepEqual(['calendar_sources', 'milestones', 'milestone_order', 'daylight_google_calendar_connections'].map(table => sqlite.prepare('SELECT * FROM ' + table).all()), beforeMigration);
sqlite.exec('DELETE FROM daylight_google_calendar_connections; DELETE FROM milestones; DELETE FROM milestone_order; DELETE FROM calendar_sources; DELETE FROM members');
const db = {
  prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first(column) { const row = sqlite.prepare(sql).get(...args); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
    };
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const origin = 'https://daylight.test';
const env = { DB: db, DAYLIGHT_AUTH_MODE: 'google', DAYLIGHT_GOOGLE_ORIGIN: origin,
  GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', DAYLIGHT_GOOGLE_INVITES: '{"calendar-test@gmail.com":{}}' };
const account = { userId: 'google:test-subject', email: 'calendar-test@gmail.com' };
const session = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(session).digest('base64url');
sqlite.prepare('INSERT INTO daylight_google_sessions VALUES (?,?,?,?,?)').run(hash, 'test-subject', account.email, 'web', Date.now() / 1000 + 3600);
const sessionCookie = '__Host-daylight-session=' + session;
const request = (path, body, extraCookie = '') => new Request(origin + path, {
  method: 'POST', headers: { Origin: origin, Cookie: sessionCookie + '; ' + extraCookie }, body,
});
const start = await handleGoogleAuth(request('/auth/google/calendar', ''), env);
const authorization = new URL(start.headers.get('location'));
assert.equal(authorization.searchParams.get('access_type'), 'offline');
assert.match(authorization.searchParams.get('prompt'), /consent/);
const state = authorization.searchParams.get('state');
const nonce = sqlite.prepare('SELECT nonce FROM daylight_google_flows WHERE state=?').get(state).nonce;
const calendarIDs = ['team-one@example.test', 'team-two@example.test'];
let failingCalendar = null;
let eventVersion = 1;
let calls = 0;
let loginClaims = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  calls++;
  const url = new URL(input);
  if (url.hostname === 'oauth2.googleapis.com') {
    const claims = loginClaims ?? { iss: 'https://accounts.google.com', aud: 'test-client', nonce, exp: Date.now() / 1000 + 600,
      sub: 'test-subject', email_verified: true, email: account.email };
    claims.exp = Math.floor(claims.exp);
    return Response.json({ access_token: 'test-access', refresh_token: options.body.get('grant_type') === 'authorization_code' ? 'test-refresh' : undefined,
      id_token: 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature', expires_in: 3600,
      scope: 'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly' });
  }
  assert.equal(url.hostname, 'www.googleapis.com');
  if (url.pathname.endsWith('/calendarList')) return Response.json({ items: calendarIDs.map((id, index) => ({ id, summary: id, primary: index === 0, accessRole: 'reader' })) });
  const id = decodeURIComponent(url.pathname.split('/')[4]);
  assert.ok(calendarIDs.includes(id), 'Only selected calendars can be read');
  if (id === failingCalendar) return new Response('', { status: 503 });
  return Response.json({ summary: id, accessRole: 'reader', items: [{ id: 'event', summary: 'Milestone ' + eventVersion,
    visibility: 'private', start: { date: today() } }] });
};
try {
  const callback = await handleGoogleAuth(new Request(origin + '/auth/google/callback?state=' + state + '&code=test-code', {
    headers: { Cookie: sessionCookie + '; __Host-daylight-google=' + state },
  }), env);
  assert.equal(callback.status, 303);
  const grantCookie = callback.headers.getSetCookie().find(value => value.startsWith('__Host-daylight-calendar=')).split(';')[0];
  const grant = await readCalendarGrant(new Headers({ Cookie: grantCookie }), hash, 'test-secret');
  assert.equal(grant.refreshToken, 'test-refresh');
  assert.equal(await readCalendarGrant(new Headers({ Cookie: grantCookie }), 'wrong-session', 'test-secret'), null);
  assert.equal(await readCalendarGrant(new Headers({ Cookie: grantCookie }), hash, 'wrong-secret'), null);
  await change(db, account, { op: 'task.add', date: today(), title: 'My daily task' });
  sqlite.prepare("INSERT INTO daylight_google_invites (email,member_id,role,invited_by,created_at) VALUES (?,?,'admin',?,?)")
    .run(account.email, account.userId, account.userId, new Date().toISOString());
  assert.equal((await handleInvitations(new Request(origin + '/api/invitations'), env)).status, 401);
  assert.equal((await handleInvitations(new Request(origin + '/api/invitations', {
    method: 'POST', headers: { Origin: 'https://other.test', Cookie: sessionCookie }, body: JSON.stringify({ email: 'friend@university.test' }),
  }), env)).status, 403);
  for (const input of [{ email: 'invalid' }, { email: 'friend@university.test', role: 'admin' }]) {
    assert.equal((await handleInvitations(request('/api/invitations', JSON.stringify(input)), env)).status, 400);
  }
  const newInvite = () => handleInvitations(request('/api/invitations', JSON.stringify({ email: ' Friend@University.Test ' })), env);
  assert.equal((await newInvite()).status, 200);
  const invitedList = await (await newInvite()).json();
  assert.equal(invitedList.canInvite, true);
  assert.deepEqual(invitedList.invitations, [{ email: 'friend@university.test', joined: 0 }]);
  const verifier = randomBytes(32).toString('base64url');
  async function signIn(claims, mac = false) {
    const query = mac ? '?client=mac&state=' + randomBytes(32).toString('base64url') + '&challenge=' + createHash('sha256').update(verifier).digest('base64url') : '';
    const started = await handleGoogleAuth(new Request(origin + '/auth/google/start' + query), env);
    const loginState = new URL(started.headers.get('location')).searchParams.get('state');
    loginClaims = { iss: 'https://accounts.google.com', aud: 'test-client', exp: Math.floor(Date.now() / 1000) + 600,
      nonce: sqlite.prepare('SELECT nonce FROM daylight_google_flows WHERE state=?').get(loginState).nonce,
      email: 'friend@university.test', sub: 'school-subject', hd: 'university.test', email_verified: true, ...claims };
    return handleGoogleAuth(new Request(origin + '/auth/google/callback?code=login-code&state=' + loginState, {
      headers: { Cookie: '__Host-daylight-google=' + loginState },
    }), env);
  }
  assert.equal((await signIn({ email_verified: false })).status, 403);
  assert.equal((await signIn({ hd: undefined })).status, 403);
  assert.equal((await signIn({ email: 'uninvited@university.test' })).status, 403);
  const schoolLogin = await signIn({});
  assert.equal(schoolLogin.status, 303);
  const schoolCookie = schoolLogin.headers.getSetCookie().find(value => value.startsWith('__Host-daylight-session=')).split(';')[0];
  const schoolSession = await getGoogleSession(new Headers({ Cookie: schoolCookie }), env);
  assert.equal(schoolSession.user.userId, 'google:school-subject');
  assert.equal(sqlite.prepare('SELECT subject FROM daylight_google_invites WHERE email=?').get('friend@university.test').subject, 'school-subject');
  assert.equal((await signIn({ sub: 'reassigned-account' })).status, 403);
  const otherRequest = new Request(origin + '/api/invitations', { headers: { Cookie: schoolCookie } });
  assert.deepEqual(await (await handleInvitations(otherRequest, env)).json(), { canInvite: false, invitations: [] });
  assert.equal((await handleInvitations(new Request(origin + '/api/invitations', {
    method: 'POST', headers: { Origin: origin, Cookie: schoolCookie }, body: JSON.stringify({ email: 'third@gmail.com' }),
  }), env)).status, 403);
  const macLogin = await signIn({}, true);
  const code = new URL(macLogin.headers.get('location')).searchParams.get('code');
  const exchanged = await handleGoogleAuth(new Request(origin + '/auth/google/token', { method: 'POST', body: JSON.stringify({ code, verifier }) }), env);
  assert.equal(exchanged.status, 200);
  const macCredential = await exchanged.json();
  assert.equal((await getGoogleSession(new Headers({ Authorization: 'Bearer ' + macCredential.session }), env, true)).user.userId, schoolSession.user.userId);
  loginClaims = null;
  const tasks = JSON.stringify((await readDay(db, account, today())).tasks);
  const selected = await handleGoogleAuth(request('/auth/google/calendar/sync', new URLSearchParams(calendarIDs.map(id => ['calendarId', id])), grantCookie), env);
  assert.equal(selected.status, 303, await selected.text());
  const stored = sqlite.prepare('SELECT refresh_token FROM daylight_google_calendar_connections').all();
  assert.equal(stored.length, 2);
  assert.ok(stored.every(row => !row.refresh_token.includes('test-refresh')));
  const order = (await readDay(db, account, today())).milestones.map(({ calendarId, eventId }) => ({ calendarId, eventId })).reverse();
  await change(db, account, { op: 'milestones.reorder', date: today(), order });
  eventVersion = 2;
  await syncSavedGoogleCalendars(env);
  let data = await readDay(db, account, today());
  assert.deepEqual(data.milestones.map(({ calendarId, eventId }) => ({ calendarId, eventId })), order);
  assert.ok(data.milestones.every(event => event.title === 'Milestone 2'));
  failingCalendar = calendarIDs[0];
  eventVersion = 3;
  await assert.rejects(syncSavedGoogleCalendars(env));
  data = await readDay(db, account, today());
  assert.equal(data.milestones.find(event => event.calendarId === failingCalendar).title, 'Milestone 2');
  assert.equal(data.milestones.find(event => event.calendarId !== failingCalendar).title, 'Milestone 3');
  assert.equal(JSON.stringify(data.tasks), tasks);
  const other = { userId: 'google:other-subject', email: 'other@gmail.com' };
  await change(db, other, { op: 'task.add', date: today(), title: 'Another person’s task' });
  await change(db, other, { op: 'note.save', date: today(), content: 'Private note' });
  await syncMilestones(db, other, { calendarId: calendarIDs[0], name: 'Another person’s calendar', from: today(), to: today(),
    events: [{ eventId: 'event', title: 'Other private event', date: today() }] }, true);
  sqlite.prepare('INSERT INTO daylight_google_calendar_connections (calendar_id,owner_id,google_sub,email,refresh_token) VALUES (?,?,?,?,?)')
    .run(calendarIDs[0], other.userId, 'other-subject', other.email, 'unreadable-test-token');
  data = await readDay(db, account, today(), true);
  assert.ok(data.milestones.every(event => event.ownerId === account.userId));
  assert.ok(data.sources.every(source => source.ownerId === account.userId));
  assert.equal(data.notes.length, 0);
  assert.ok(data.tasks.some(task => task.ownerId === other.userId), 'People can see each other’s tasks');
  await assert.rejects(change(db, account, { op: 'task.patch', id: data.tasks.find(task => task.ownerId === other.userId).id, done: true }));
  const otherData = await readDay(db, other, today(), true);
  assert.equal(otherData.milestones.length, 1);
  assert.equal(otherData.milestones[0].title, 'Other private event');
  assert.equal((await calendarSyncStatus(env, account.userId)).length, 2);
  failingCalendar = null;
  await syncSavedGoogleCalendars(env, account.userId);
  assert.equal(sqlite.prepare('SELECT enabled FROM daylight_google_calendar_connections WHERE owner_id=?').get(other.userId).enabled, 1,
    'Manual sync cannot use another person’s connection');
  assert.equal((await readDay(db, other, today(), true)).milestones[0].title, 'Other private event');
  sqlite.exec('UPDATE daylight_google_calendar_connections SET locked_until=9999999999');
  const previousCalls = calls;
  await syncSavedGoogleCalendars(env);
  assert.equal(calls, previousCalls, 'A concurrent import does not read or overwrite another snapshot');
  sqlite.exec('UPDATE daylight_google_calendar_connections SET locked_until=0');
  sqlite.exec('DELETE FROM daylight_google_invites');
  env.DAYLIGHT_GOOGLE_INVITES = '{}';
  await assert.rejects(syncSavedGoogleCalendars(env));
  assert.equal(calls, previousCalls, 'Revoked members cannot continue background access');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM daylight_google_calendar_connections WHERE enabled=1').get().n, 0);
  console.log('PASS: owner-only invitations, duplicate and malformed requests, CSRF, school Google login, bound account identity, Mac sign-in, calendar privacy, saved data, encrypted grants, sync leases and revoked access.');
} finally { globalThis.fetch = originalFetch; sqlite.close(); }
