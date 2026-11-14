import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";
import { renderReceiptPage, type ResultReceipt } from "../../../lib/result-receipts.ts";
import { loadResultsSummary } from "../../../lib/results-summary.ts";
import { REPO_ROOT } from "../../../lib/site-inputs.ts";
import { siteOrigin } from "../../../lib/site-origin.ts";

export async function getStaticPaths() {
  const { receipts } = await loadResultsSummary();
  return receipts.map((receipt) => ({ params: { id: receipt.resultId }, props: { receipt } }));
}

let template: string | undefined;

export const GET: APIRoute = ({ props }) => {
  template ??= readFileSync(path.join(REPO_ROOT, "explorer", "dist", "index.html"), "utf-8");
  return new Response(renderReceiptPage(template, props.receipt as ResultReceipt, siteOrigin()), { headers: { "Content-Type": "text/html; charset=utf-8" } });
};
