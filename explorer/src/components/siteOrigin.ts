const DEFAULT_SITE_ORIGIN = "https://benchbox.dev";

export const SITE_ORIGIN: string = (import.meta.env.SITE_ORIGIN ?? DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
