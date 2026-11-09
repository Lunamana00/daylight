import type { Identity } from "./planner-core";
import { PlannerError } from "./planner-core";
import { calendarEventsScope, calendarListScope, selectGoogleCalendars, syncGoogleCalendar } from "./google-calendar";

const sessionCookie = "__Host-daylight-session";
const flowCookie = "__Host-daylight-google";
const calendarCookie = "__Host-daylight-calendar";
const flowSeconds = 600;
const codeSeconds = 120;
const sessionSeconds = 7 * 24 * 60 * 60;
const callbackPath = "/auth/google/callback";

type Client = "web" | "mac";
type Account = { google_sub: string; email: string };
type Flow = {
  verifier: string;
  nonce: string;
  mac_challenge: string | null;
  mac_state: string | null;
};
type Invite = { memberId?: string; subject?: string };
type CalendarFlow = { sessionHash: string };
type GoogleTokens = { id_token?: unknown; access_token?: unknown; refresh_token?: unknown; scope?: unknown; expires_in?: number; error?: string };
type CalendarGrant = { accessToken: string; refreshToken: string };
type CalendarConnection = { calendar_id: string; owner_id: string; google_sub: string; email: string; refresh_token: string };

function now() {
  return Math.floor(Date.now() / 1000);
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unbase64url(value: string) {
  const encoded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")), c => c.charCodeAt(0));
}

function token() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

async function digest(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function cookie(headers: Pick<Headers, "get">, key: string) {
  return headers.get("cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(key + "="))?.slice(key.length + 1);
}

function setCookie(key: string, value: string, maxAge: number) {
  return `${key}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

const utf8 = new TextEncoder();
async function calendarGrantKey(secret: string) {
  const material = await crypto.subtle.importKey("raw", utf8.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: utf8.encode("daylight/calendar-grant/v1"),
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function sealCalendarValue(value: string, binding: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(binding) },
    await calendarGrantKey(secret), utf8.encode(value));
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}

async function openCalendarValue(value: string, binding: string, secret: string) {
  const [iv, encrypted] = value.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64url(iv), additionalData: utf8.encode(binding) },
    await calendarGrantKey(secret), unbase64url(encrypted));
  return new TextDecoder().decode(plain);
}

function googleToken(value: unknown, max = 2048): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/\s/.test(value);
}

async function sealCalendarGrant(grant: CalendarGrant, seconds: number, sessionHash: string, secret: string) {
  const value = await sealCalendarValue(JSON.stringify({ ...grant, expiresAt: now() + seconds }), sessionHash, secret);
  if (value.length > 3800) throw new PlannerError("Google 캘린더 연결 정보를 저장하지 못했어요. 다시 연결해 주세요.", 502);
  return setCookie(calendarCookie, value, seconds);
}

export async function readCalendarGrant(headers: Pick<Headers, "get">, sessionHash: string, secret: string): Promise<CalendarGrant | null> {
  const value = cookie(headers, calendarCookie);
  if (!value || value.length > 3800) return null;
  try {
    const { accessToken, refreshToken, expiresAt } = JSON.parse(await openCalendarValue(value, sessionHash, secret));
    return googleToken(accessToken) && googleToken(refreshToken, 512) && Number.isFinite(expiresAt) && expiresAt > now()
      ? { accessToken, refreshToken } : null;
  } catch { return null; }
}

function connectionBinding(calendarId: string, ownerId: string, googleSub: string) {
  return JSON.stringify(["daylight/calendar-refresh/v1", calendarId, ownerId, googleSub]);
}

async function saveCalendarConnection(db: D1Database, user: Identity, googleSub: string, calendarId: string, refreshToken: string, secret: string) {
  const encrypted = await sealCalendarValue(refreshToken, connectionBinding(calendarId, user.userId, googleSub), secret);
  const saved = await db.prepare(
    "INSERT INTO daylight_google_calendar_connections (calendar_id,owner_id,google_sub,email,refresh_token) VALUES (?,?,?,?,?) ON CONFLICT(owner_id,calendar_id) DO UPDATE SET google_sub=excluded.google_sub,email=excluded.email,refresh_token=excluded.refresh_token,enabled=1,locked_until=0,lease_id=NULL,last_error=NULL",
  ).bind(calendarId, user.userId, googleSub, user.email, encrypted).run();
  if (!saved.meta.changes) throw new PlannerError("캘린더를 연결한 계정에서 다시 연결해 주세요.", 403);
}

export async function calendarSyncStatus(env: Cloudflare.Env, userId: string) {
  if (env.DAYLIGHT_AUTH_MODE !== "google" || !env.DB) return undefined;
  const connections = await env.DB.prepare(
    "SELECT calendar_id,owner_id,enabled,last_error FROM daylight_google_calendar_connections WHERE owner_id=?",
  ).bind(userId).all<{ calendar_id: string; owner_id: string; enabled: number; last_error: string | null }>();
  return connections.results.map(connection => ({ calendarId: connection.calendar_id, enabled: !!connection.enabled,
    canManage: connection.owner_id === userId, error: connection.last_error }));
}

export async function syncSavedGoogleCalendars(env: Cloudflare.Env, ownerId?: string) {
  if (env.DAYLIGHT_AUTH_MODE !== "google" || !env.DB) return;
  const calendars = await env.DB.prepare("SELECT calendar_id,owner_id FROM daylight_google_calendar_connections WHERE enabled=1 AND (? IS NULL OR owner_id=?)")
    .bind(ownerId ?? null, ownerId ?? null).all<{ calendar_id: string; owner_id: string }>();
  let failure: unknown;
  for (const { calendar_id, owner_id } of calendars.results) {
    try { await syncSavedGoogleCalendar(env, calendar_id, owner_id); }
    catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
}

async function syncSavedGoogleCalendar(env: Cloudflare.Env, calendarId: string, ownerId: string) {
  const { DB: db, GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: secret } = env;
  if (env.DAYLIGHT_AUTH_MODE !== "google" || !db || !clientId || !secret) return;
  const lease = token();
  // The lease covers the bounded Google pagination and prevents overlapping imports.
  const connection = await db.prepare(
    "UPDATE daylight_google_calendar_connections SET locked_until=?,lease_id=? WHERE calendar_id=? AND owner_id=? AND enabled=1 AND locked_until<=? RETURNING calendar_id,owner_id,google_sub,email,refresh_token",
  ).bind(now() + 300, lease, calendarId, ownerId, now()).first<CalendarConnection>();
  if (!connection) return;
  try {
    const invite = await inviteFor(env, connection);
    if (!invite || (invite.memberId ?? `google:${connection.google_sub}`) !== connection.owner_id) {
      throw new PlannerError("캘린더를 연결한 계정으로 Google 캘린더를 다시 연결해 주세요.", 428);
    }
    let refreshToken: string;
    try {
      refreshToken = await openCalendarValue(connection.refresh_token,
        connectionBinding(connection.calendar_id, connection.owner_id, connection.google_sub), secret);
      if (!googleToken(refreshToken, 512)) throw new Error("Invalid credential");
    } catch { throw new PlannerError("Google 캘린더를 다시 연결해 주세요.", 428); }
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ client_id: clientId, client_secret: secret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const tokens = await response.json() as GoogleTokens;
    if (tokens.error === "invalid_grant") throw new PlannerError("Google 캘린더 연결이 만료됐어요. 다시 연결해 주세요.", 428);
    if (!response.ok || !googleToken(tokens.access_token)
        || (tokens.scope !== undefined && (typeof tokens.scope !== "string" || !tokens.scope.split(" ").includes(calendarEventsScope)))) {
      throw new PlannerError("Google 캘린더를 동기화하지 못했어요. 잠시 후 다시 시도해 주세요.", 502);
    }
    if (tokens.refresh_token !== undefined) {
      if (!googleToken(tokens.refresh_token, 512)) throw new PlannerError("Google 캘린더를 다시 연결해 주세요.", 428);
      const rotated = await sealCalendarValue(tokens.refresh_token,
        connectionBinding(connection.calendar_id, connection.owner_id, connection.google_sub), secret);
      await db.prepare("UPDATE daylight_google_calendar_connections SET refresh_token=? WHERE lease_id=?").bind(rotated, lease).run();
    }
    await syncGoogleCalendar(db, { userId: connection.owner_id, email: connection.email }, connection.calendar_id, tokens.access_token);
    await db.prepare("UPDATE daylight_google_calendar_connections SET last_error=NULL WHERE lease_id=?").bind(lease).run();
  } catch (error) {
    const reconnect = error instanceof PlannerError && error.status === 428;
    await db.prepare("UPDATE daylight_google_calendar_connections SET enabled=?,last_error=? WHERE lease_id=?")
      .bind(reconnect ? 0 : 1, reconnect ? "reconnect" : "unavailable", lease).run();
    throw error instanceof PlannerError ? error : new PlannerError("Google 캘린더에 연결하지 못했어요. 자동으로 다시 시도합니다.", 502);
  } finally {
    await db.prepare("UPDATE daylight_google_calendar_connections SET locked_until=0,lease_id=NULL WHERE lease_id=?").bind(lease).run();
  }
}

function reply(message: string, status: number) {
  return new Response(message, { status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
}

function redirectTo(location: string, ...cookies: string[]) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}

async function inviteFor(env: Cloudflare.Env, { email, google_sub }: Account): Promise<Invite | null> {
  let invites: Record<string, Invite>;
  try { invites = JSON.parse(env.DAYLIGHT_GOOGLE_INVITES ?? "{}"); }
  catch { return null; }
  if (!invites || typeof invites !== "object" || Array.isArray(invites)) return null;
  const configured = Object.hasOwn(invites, email);
  let invite = invites[email];
  if (!configured) {
    const stored = await env.DB?.prepare("SELECT subject,member_id AS memberId FROM daylight_google_invites WHERE email=?")
      .bind(email).first<{ subject: string | null; memberId: string | null }>();
    if (!stored) return null;
    invite = { subject: stored.subject ?? undefined, memberId: stored.memberId ?? undefined };
  }
  if (!invite || typeof invite !== "object" || Array.isArray(invite)) return null;
  if (invite.subject !== undefined && invite.subject !== google_sub) return null;
  if (invite.memberId !== undefined) {
    if (typeof invite.memberId !== "string" || !invite.memberId.trim() || (configured && invite.memberId.startsWith("google:"))) return null;
    if (configured && Object.entries(invites).some(([other, entry]) => other !== email && entry?.memberId === invite.memberId)) return null;
  }
  return invite;
}

function sessionCredential(headers: Pick<Headers, "get">, allowMac: boolean) {
  const authorization = headers.get("authorization");
  if (authorization !== null) {
    const value = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
    return allowMac && isToken(value) ? { value, client: "mac" as const } : null;
  }
  const value = cookie(headers, sessionCookie);
  return isToken(value) ? { value, client: "web" as const } : null;
}

export async function getGoogleSession(
  headers: Pick<Headers, "get">,
  env: Cloudflare.Env,
  allowMac = false,
): Promise<{ user: Identity; client: Client; sessionHash: string; googleSub: string } | null> {
  const credential = sessionCredential(headers, allowMac);
  if (!credential || !env.DB) return null;
  const sessionHash = await digest(credential.value);
  const account = await env.DB.prepare(
    "SELECT google_sub,email FROM daylight_google_sessions WHERE session_hash=? AND client=? AND expires_at>?",
  ).bind(sessionHash, credential.client, now()).first<Account>();
  const invite = account && await inviteFor(env, account);
  if (!account || !invite) return null;
  return {
    user: { userId: invite.memberId ?? `google:${account.google_sub}`, email: account.email },
    client: credential.client,
    sessionHash,
    googleSub: account.google_sub,
  };
}

async function issueSession(db: D1Database, account: Account, client: Client) {
  const session = token();
  const expiresAt = now() + sessionSeconds;
  await db.batch([
    db.prepare("DELETE FROM daylight_google_sessions WHERE expires_at<=?").bind(now()),
    db.prepare("INSERT INTO daylight_google_sessions (session_hash,google_sub,email,client,expires_at) VALUES (?,?,?,?,?)")
      .bind(await digest(session), account.google_sub, account.email, client, expiresAt),
  ]);
  return { session, expiresAt };
}

async function readGoogleAccount(
  id_token: unknown, clientId: string, flow: Flow, env: Cloudflare.Env,
): Promise<Account | null> {
  if (typeof id_token !== "string") return null;
  const parts = id_token.split(".");
  if (parts.length !== 3) return null;
  const claims = JSON.parse(new TextDecoder().decode(unbase64url(parts[1])));
  // The ID token is accepted only from Google's HTTPS code exchange, never from a client.
  if (!claims || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)
      || claims.aud !== clientId || (claims.azp !== undefined && claims.azp !== clientId)
      || claims.nonce !== flow.nonce || !Number.isSafeInteger(claims.exp) || claims.exp <= now()
      || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255
      || claims.email_verified !== true || typeof claims.email !== "string") return null;
  const account = { google_sub: claims.sub, email: claims.email.trim().toLowerCase() };
  const invite = await inviteFor(env, account);
  if (!invite) return null;
  const googleOwnsEmail = account.email.endsWith("@gmail.com") || (typeof claims.hd === "string" && !!claims.hd);
  if (!googleOwnsEmail && invite.subject !== account.google_sub) return null;
  if (invite.memberId && !await env.DB?.prepare("SELECT id FROM members WHERE id=?").bind(invite.memberId).first()) return null;
  // Bind a new invitation to the first Google-verified account, even if its email later changes hands.
  await env.DB?.prepare("UPDATE daylight_google_invites SET subject=? WHERE email=? AND subject IS NULL")
    .bind(account.google_sub, account.email).run();
  if (!await inviteFor(env, account)) return null;
  return account;
}

export async function handleInvitations(request: Request, env: Cloudflare.Env): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    if (env.DAYLIGHT_AUTH_MODE !== "google" || !env.DB) throw new PlannerError("초대 기능을 사용할 수 없습니다.", 404);
    if (!["GET", "POST"].includes(request.method)) throw new PlannerError("지원하지 않는 요청입니다.", 405);
    if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
      throw new PlannerError("daylight에서 초대해 주세요.", 403);
    }
    const session = await getGoogleSession(request.headers, env);
    if (!session) throw new PlannerError("로그인이 필요합니다.", 401);
    const canInvite = !!await env.DB.prepare("SELECT 1 FROM daylight_google_invites WHERE role='admin' AND email=? AND member_id=?")
      .bind(session.user.email, session.user.userId).first();
    if (request.method === "POST") {
      if (!canInvite) throw new PlannerError("초대 관리 권한이 필요합니다.", 403);
      const body = await request.text();
      if (body.length > 1024) throw new PlannerError("이메일 주소를 확인해 주세요.");
      let input;
      try { input = JSON.parse(body); } catch { throw new PlannerError("이메일 주소를 확인해 주세요."); }
      const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
      if (!input || Array.isArray(input) || Object.keys(input).some(key => key !== "email")
          || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
        throw new PlannerError("올바른 이메일 주소를 입력해 주세요.");
      }
      await env.DB.prepare("INSERT INTO daylight_google_invites (email,invited_by,created_at) VALUES (?,?,?) ON CONFLICT(email) DO NOTHING")
        .bind(email, session.user.userId, new Date().toISOString()).run();
    }
    const invitations = canInvite ? (await env.DB.prepare("SELECT i.email,EXISTS(SELECT 1 FROM members m WHERE m.email=i.email) AS joined FROM daylight_google_invites i WHERE i.role='member' ORDER BY i.created_at DESC,i.email")
      .all<{ email: string; joined: number }>()).results : [];
    return Response.json({ canInvite, invitations }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof PlannerError ? error.message : "초대 목록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: error instanceof PlannerError ? error.status : 500, headers });
  }
}

export async function handleGoogleAuth(request: Request, env: Cloudflare.Env): Promise<Response> {
  const url = new URL(request.url);
  const { DB: db, GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = env;
  if (!db || !clientId || !clientSecret || url.protocol !== "https:" || url.origin !== env.DAYLIGHT_GOOGLE_ORIGIN) {
    return reply("Google 로그인 설정이 필요합니다.", 503);
  }
  const redirectUri = url.origin + callbackPath;

  try {
    const calendarStart = request.method === "POST" && url.pathname === "/auth/google/calendar";
    const calendarSelection = request.method === "POST" && url.pathname === "/auth/google/calendar/sync";
    const calendarDisconnect = request.method === "POST" && url.pathname === "/auth/google/calendar/disconnect";
    const calendarRequest = calendarStart || calendarSelection || calendarDisconnect;
    if (calendarRequest && request.headers.get("origin") !== url.origin) {
      return reply("daylight에서 캘린더를 연결해 주세요.", 403);
    }
    const calendarSession = calendarRequest ? await getGoogleSession(request.headers, env) : null;
    if (calendarRequest && !calendarSession) return reply("daylight에 먼저 로그인해 주세요.", 401);

    if (calendarDisconnect && calendarSession) {
      const body = await request.text();
      if (body.length > 2048) return reply("올바른 연결 해제 요청이 아니에요.", 400);
      await db.prepare("DELETE FROM daylight_google_calendar_connections WHERE calendar_id=? AND owner_id=?")
        .bind(new URLSearchParams(body).get("calendarId"), calendarSession.user.userId).run();
      return redirectTo("/", setCookie(calendarCookie, "", 0));
    }

    if (calendarSelection && calendarSession) {
      const grant = await readCalendarGrant(request.headers, calendarSession.sessionHash, clientSecret);
      if (!grant) return reply("캘린더 연결 시간이 지났어요. daylight에서 다시 시작해 주세요.", 401);
      const form = await request.text();
      if (form.length > 24000) return reply("올바른 캘린더 선택이 아니에요.", 400);
      const ids = await selectGoogleCalendars(new URLSearchParams(form).getAll("calendarId"), grant.accessToken);
      for (const id of ids) {
        await syncGoogleCalendar(db, calendarSession.user, id, grant.accessToken);
        await saveCalendarConnection(db, calendarSession.user, calendarSession.googleSub, id, grant.refreshToken, clientSecret);
      }
      await db.prepare(`DELETE FROM daylight_google_calendar_connections WHERE owner_id=? AND calendar_id NOT IN (${ids.map(() => "?").join(",")})`)
        .bind(calendarSession.user.userId, ...ids).run();
      return redirectTo("/", setCookie(calendarCookie, "", 0));
    }

    if (calendarStart || (request.method === "GET" && url.pathname === "/auth/google/start")) {
      const mac = url.searchParams.get("client") === "mac";
      const challenge = !calendarStart && mac ? url.searchParams.get("challenge") : null;
      const macState = !calendarStart && mac ? url.searchParams.get("state") : null;
      if (!calendarStart && mac && (!isToken(challenge) || !isToken(macState))) return reply("Mac 로그인 요청을 확인해 주세요.", 400);
      const state = token(), verifier = token(), nonce = token();
      const statements = [
        db.prepare("DELETE FROM daylight_google_flows WHERE expires_at<=?").bind(now()),
        db.prepare("INSERT INTO daylight_google_flows (state,verifier,nonce,mac_challenge,mac_state,expires_at) VALUES (?,?,?,?,?,?)")
          .bind(state, verifier, nonce, challenge, macState, now() + flowSeconds),
      ];
      const scopes = ["openid", "email"];
      if (calendarSession) {
        statements.push(db.prepare("INSERT INTO daylight_google_calendar_flows (state,session_hash) VALUES (?,?)")
          .bind(state, calendarSession.sessionHash));
        scopes.push(calendarEventsScope, calendarListScope);
      }
      await db.batch(statements);
      const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      google.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: scopes.join(" "),
        state, nonce, code_challenge: await digest(verifier), code_challenge_method: "S256",
        prompt: calendarSession ? "consent select_account" : "select_account",
        ...(calendarSession ? { access_type: "offline" } : {}),
      }).toString();
      return redirectTo(google.href, setCookie(flowCookie, state, flowSeconds));
    }

    if (request.method === "GET" && url.pathname === callbackPath) {
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!isToken(state) || state !== cookie(request.headers, flowCookie) || (code?.length ?? 0) > 2048) {
        return reply("daylight에서 Google 로그인을 다시 시작해 주세요.", 400);
      }
      const calendarFlow = await db.prepare(
        "SELECT session_hash AS sessionHash FROM daylight_google_calendar_flows WHERE state=?",
      ).bind(state).first<CalendarFlow>();
      const flow = await db.prepare(
        "DELETE FROM daylight_google_flows WHERE state=? AND expires_at>? RETURNING verifier,nonce,mac_challenge,mac_state",
      ).bind(state, now()).first<Flow>();
      if (!flow) return reply("로그인 시간이 지났습니다. 다시 시도해 주세요.", 400);
      const activeCalendarSession = calendarFlow ? await getGoogleSession(request.headers, env) : null;
      if (calendarFlow && activeCalendarSession?.sessionHash !== calendarFlow.sessionHash) {
        return reply("캘린더 연결을 시작한 계정으로 다시 시도해 주세요.", 401);
      }
      if (!code) return calendarFlow
        ? redirectTo("/", setCookie(flowCookie, "", 0))
        : reply("daylight에서 Google 로그인을 다시 시작해 주세요.", 400);
      const google = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
          grant_type: "authorization_code", code_verifier: flow.verifier,
        }),
      });
      const tokens = google.ok ? await google.json() as GoogleTokens : null;
      const account = await readGoogleAccount(tokens?.id_token, clientId, flow, env);
      if (!account) return reply("초대된 Google 계정으로 로그인해 주세요.", 403);
      if (calendarFlow && activeCalendarSession) {
        if (account.google_sub !== activeCalendarSession.googleSub) {
          return reply("daylight에 로그인한 Google 계정으로 캘린더를 연결해 주세요.", 403);
        }
        const scopes = typeof tokens?.scope === "string" ? tokens.scope.split(" ") : [];
        const accessToken = tokens?.access_token;
        if (!scopes.includes(calendarEventsScope) || !scopes.includes(calendarListScope) || !googleToken(accessToken)) {
          return reply("Google 캘린더 읽기 권한을 승인해 주세요.", 403);
        }
        const refreshToken = tokens?.refresh_token;
        if (!googleToken(refreshToken, 512)) {
          return reply("자동 동기화를 위해 Google 캘린더의 백그라운드 접근을 승인해 주세요.", 403);
        }
        const seconds = Math.min(flowSeconds, Math.floor(tokens?.expires_in ?? flowSeconds));
        if (!Number.isFinite(seconds) || seconds <= 0) return reply("Google 캘린더를 다시 연결해 주세요.", 401);
        const grant = await sealCalendarGrant({ accessToken, refreshToken }, seconds, activeCalendarSession.sessionHash, clientSecret);
        return redirectTo("/calendar", setCookie(flowCookie, "", 0), grant);
      }
      if (flow.mac_challenge && flow.mac_state) {
        const macCode = token();
        await db.batch([
          db.prepare("DELETE FROM daylight_google_mac_codes WHERE expires_at<=?").bind(now()),
          db.prepare("INSERT INTO daylight_google_mac_codes (code_hash,challenge,google_sub,email,expires_at) VALUES (?,?,?,?,?)")
            .bind(await digest(macCode), flow.mac_challenge, account.google_sub, account.email, now() + codeSeconds),
        ]);
        const callback = new URL("daylight-mac://auth");
        callback.search = new URLSearchParams({ code: macCode, state: flow.mac_state }).toString();
        return redirectTo(callback.href, setCookie(flowCookie, "", 0));
      }
      const { session } = await issueSession(db, account, "web");
      return redirectTo("/", setCookie(flowCookie, "", 0), setCookie(sessionCookie, session, sessionSeconds));
    }

    if (request.method === "POST" && url.pathname === "/auth/google/token") {
      let input: { code?: unknown; verifier?: unknown };
      try {
        const body = await request.text();
        if (body.length > 1024) return reply("잘못된 Mac 로그인 요청입니다.", 400);
        input = JSON.parse(body);
      } catch { return reply("잘못된 Mac 로그인 요청입니다.", 400); }
      if (!input || !isToken(input.code) || !isToken(input.verifier)) return reply("잘못된 Mac 로그인 요청입니다.", 400);
      const account = await db.prepare(
        "DELETE FROM daylight_google_mac_codes WHERE code_hash=? AND challenge=? AND expires_at>? RETURNING google_sub,email",
      ).bind(await digest(input.code), await digest(input.verifier), now()).first<Account>();
      if (!account || !await inviteFor(env, account)) return reply("Mac에서 Google 로그인을 다시 시작해 주세요.", 401);
      return Response.json(await issueSession(db, account, "mac"), { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "POST" && url.pathname === "/auth/google/logout") {
      const credential = sessionCredential(request.headers, true);
      if (credential?.client !== "mac" && request.headers.get("origin") !== url.origin) {
        return reply("같은 사이트에서만 로그아웃할 수 있습니다.", 403);
      }
      if (credential) {
        await db.prepare("DELETE FROM daylight_google_sessions WHERE session_hash=? AND client=?")
          .bind(await digest(credential.value), credential.client).run();
      }
      return credential?.client === "mac"
        ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
        : redirectTo("/", setCookie(sessionCookie, "", 0), setCookie(flowCookie, "", 0), setCookie(calendarCookie, "", 0));
    }

    return reply("페이지를 찾을 수 없습니다.", 404);
  } catch (error) {
    if (error instanceof PlannerError) return reply(error.message, error.status);
    return reply("Google 로그인을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
}
