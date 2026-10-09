const DEFAULT_SITE_ORIGIN = "https://benchbox.dev";

const injected = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.SITE_ORIGIN;

export const SITE_ORIGIN: string = (injected ?? DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
