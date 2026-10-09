export const DEFAULT_SITE_ORIGIN = "https://benchbox.dev";

export function siteOrigin(env: Record<string, string | undefined> = process.env): string {
  return (env.SITE_ORIGIN ?? DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
}

export function siteHost(env: Record<string, string | undefined> = process.env): string {
  return env.SITE_HOST ?? new URL(siteOrigin(env)).host;
}
