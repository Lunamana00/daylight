import { env } from "cloudflare:workers";
import { handleInvitations } from "../../../lib/google-auth";

export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleInvitations(request, env); }
export function POST(request: Request) { return handleInvitations(request, env); }
