declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DAYLIGHT_AUTH_MODE?: "google";
    DAYLIGHT_GOOGLE_ORIGIN?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    DAYLIGHT_GOOGLE_INVITES?: string;
  }
}
