import { resolve } from "node:path";

export function siteInputsPath(...parts: string[]): string {
  return resolve(process.env.SITE_INPUTS ?? resolve(process.cwd(), "..", ".site-inputs"), ...parts);
}
