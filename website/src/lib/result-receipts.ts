import { canonicalBenchmarkSlug, canonicalPhase, formatArchitecture, formatBenchmarkLabel, formatCpuFamily, formatExecutionMode, formatMemoryGb, formatPhaseWithStreams, formatTrustLabel, formatTuningMode } from "@/lib/displayLabels";
import { formatTimingExclusion, normalizePrimaryMetric, primaryMetricHigherIsBetter, primaryMetricLabel, primaryMetricValue, type PrimaryMetric } from "@/lib/displayEligibility";
import { detailResultFromWideRow, getPrimaryMetricForBenchmark, getResultDetailMetrics, type ResultDetailMetricsRow, type ResultRow } from "@/lib/duckdbQueries";
import { formatScaleFactor, formatScoreMetric } from "@/lib/metricFormatters";
import { visibleResultIdForRow } from "@/lib/resultLinks";
import { formatRunDate } from "@/lib/runAge";
import { complianceBadge, derivedResultsDisclaimer, derivedTpcName, isDerivedPowerScore } from "@/lib/subscale";
import { platformVersionDisplay } from "@/lib/versionLabel";
import { fmtGeomean } from "@/utils";
import { formatCitationBlock } from "./results-embed.ts";

export const RECEIPT_ROOT = "/results/r";

const RESULT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NOT_RECORDED = "Not recorded";

export interface ReceiptRow {
  label: string;
  value: string;
  href?: string;
  code?: boolean;
}

export interface ReceiptSection {
  title: string;
  rows: ReceiptRow[];
}

export interface ResultReceipt {
  resultId: string;
  title: string;
  description: string;
  headline: string;
  ranked: boolean;
  rankingStatus: string;
  derivedNotice: string | null;
  sections: ReceiptSection[];
  citeLine: string;
  citationBlock: string;
  bundleHref: string;
  summaryHrefs: { label: string; href: string }[];
}

export interface ReceiptSnapshot {
  snapshotSha256: string;
  snapshotDate: string;
}

export function receiptPath(resultId: string): string {
  if (!RESULT_ID_PATTERN.test(resultId)) throw new Error(`result id is not a safe path segment: ${JSON.stringify(resultId)}`);
  return `${RECEIPT_ROOT}/${resultId}`;
}

function recorded(value: string | number | null | undefined, format: (raw: string) => string = (raw) => raw): string {
  if (value === null || value === undefined || value === "") return NOT_RECORDED;
  return format(String(value));
}

export function buildReceipt(wide: ResultDetailMetricsRow, primaryMetric: PrimaryMetric, snapshot: ReceiptSnapshot): ResultReceipt {
  const detail = detailResultFromWideRow(wide, [], []);
  const benchmarkId = canonicalBenchmarkSlug(detail.benchmark);
  const benchmark = formatBenchmarkLabel(benchmarkId);
  const phase = formatPhaseWithStreams(canonicalPhase(wide.test_type), wide.stream_count);
  const scale = formatScaleFactor(detail.scale_factor);
  const version = platformVersionDisplay(wide).text;
  const platformWithVersion = version === null ? detail.platform : `${detail.platform} ${version}`;
  const runDate = formatRunDate(detail.run_date);
  const metric = normalizePrimaryMetric(primaryMetric);
  const metricValue = metric === "display_geomean_ms" ? fmtGeomean(detail.display_geomean_ms) : formatScoreMetric(metric, primaryMetricValue(detail, metric));
  const direction = primaryMetricHigherIsBetter(metric) ? "higher is better" : "lower is better";
  const headline = `${primaryMetricLabel(metric)}: ${metricValue} (${direction})`;
  const ranked = detail.ranking_exclusion_reason === null;
  const rankingStatus = ranked ? "Ranked" : "Not ranked";
  const rankingReason = ranked ? "Included in the rankings for its benchmark, scale factor and phase." : formatTimingExclusion(detail.ranking_exclusion_reason, "This result is not included in rankings.");
  const derivedName = derivedTpcName(detail.benchmark);
  const derivedNotice = derivedName === null ? null : derivedResultsDisclaimer(derivedName);
  const compliance = recorded(detail.compliance_class, (raw) => complianceBadge(raw) ?? raw);
  const environment = detail.environment;
  const citation = {
    result: detail.result_id,
    snapshot: snapshot.snapshotSha256,
    snapshotDate: snapshot.snapshotDate,
    platform: platformWithVersion,
    benchmark,
    scale,
    runDate,
    metric: primaryMetricLabel(metric),
    direction,
    value: metricValue,
  };
  const platformSummary = { label: `${detail.platform} summary`, href: `/result-summaries/platforms/${detail.platform_id}.html` };
  const benchmarkSummary = { label: `${benchmark} summary`, href: `/result-summaries/benchmarks/${benchmarkId}.html` };

  const sections: ReceiptSection[] = [
    {
      title: "Result",
      rows: [
        { label: "Benchmark", value: benchmark },
        { label: "Platform", value: detail.platform },
        { label: "Platform version", value: recorded(version) },
        { label: "Scale factor", value: scale },
        { label: "Phase", value: phase },
        { label: "Run date", value: runDate },
        { label: primaryMetricLabel(metric), value: `${metricValue} (${direction})` },
        { label: "Geomean query time", value: fmtGeomean(detail.display_geomean_ms) },
        ...(isDerivedPowerScore(detail.power_score_source) ? [{ label: "Power@Size source", value: "Derived from exported query timings" }] : []),
      ],
    },
    {
      title: "Ranking and trust",
      rows: [
        { label: "Ranking status", value: rankingStatus },
        { label: "Ranking reason", value: rankingReason },
        { label: "Trust label", value: formatTrustLabel(detail.trust_label) },
        { label: "Compliance", value: compliance },
        { label: "Validation status", value: recorded(wide.validation_status, (raw) => raw.replace(/[_-]+/g, " ")) },
      ],
    },
    {
      title: "Tuning and execution",
      rows: [
        { label: "Tuning mode", value: recorded(detail.tuning_mode, formatTuningMode) },
        { label: "Execution mode", value: recorded(detail.execution_mode, formatExecutionMode) },
        { label: "Driver version", value: recorded(detail.driver_version) },
        { label: "Client cloud", value: recorded(environment.client_cloud) },
        { label: "Client region", value: recorded(environment.client_region) },
        { label: "Operating system", value: recorded(environment.os) },
        { label: "Architecture", value: recorded(environment.arch, formatArchitecture) },
        { label: "CPU family", value: recorded(environment.cpu_family, formatCpuFamily) },
        { label: "CPU model", value: recorded(environment.cpu_model) },
        { label: "CPU count", value: recorded(environment.cpu_count) },
        { label: "Memory", value: environment.memory_gb === undefined ? NOT_RECORDED : formatMemoryGb(environment.memory_gb) },
        { label: "Python", value: recorded(environment.python) },
      ],
    },
    {
      title: "Artifacts",
      rows: [
        { label: "Result ID", value: detail.result_id, code: true },
        { label: "Public ID", value: visibleResultIdForRow(detail), code: true },
        { label: "Bundle JSON", value: detail.bundle_download_url, href: detail.bundle_download_url },
      ],
    },
  ];

  return {
    resultId: detail.result_id,
    title: `${benchmark} on ${platformWithVersion}, ${scale}, ${runDate}`,
    description: `${benchmark} ${scale} ${phase} run on ${platformWithVersion} from ${runDate}. ${headline}. ${rankingStatus}.`,
    headline,
    ranked,
    rankingStatus,
    derivedNotice,
    sections,
    citeLine: `Cite as: ${platformWithVersion}, ${benchmark}, ${scale}, run ${runDate}, result ${detail.result_id}, BenchBox results snapshot sha256:${snapshot.snapshotSha256} of ${snapshot.snapshotDate}.`,
    citationBlock: formatCitationBlock(citation),
    bundleHref: detail.bundle_download_url,
    summaryHrefs: [platformSummary, benchmarkSummary],
  };
}

export async function buildReceipts(rows: readonly ResultRow[], snapshot: ReceiptSnapshot): Promise<ResultReceipt[]> {
  const receipts: ResultReceipt[] = [];
  const metrics = new Map<string, PrimaryMetric>();
  for (const row of rows) {
    const wide = await getResultDetailMetrics(row.result_id);
    if (wide === null) throw new Error(`published result ${row.result_id} has no row in result_detail_metrics, so it cannot get a permalink page`);
    const phase = canonicalPhase(wide.test_type);
    const key = `${canonicalBenchmarkSlug(wide.benchmark)}\u0000${phase}`;
    let metric = metrics.get(key);
    if (metric === undefined) {
      metric = await getPrimaryMetricForBenchmark(wide.benchmark, phase);
      metrics.set(key, metric);
    }
    receipts.push(buildReceipt(wide, metric, snapshot));
  }
  return receipts.sort((left, right) => left.resultId.localeCompare(right.resultId));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderRow(row: ReceiptRow): string {
  const text = escapeHtml(row.value);
  const content = row.href === undefined ? (row.code ? `<code>${text}</code>` : text) : `<a href="${escapeHtml(row.href)}">${text}</a>`;
  return `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${content}</td></tr>`;
}

function renderSection(section: ReceiptSection): string {
  return `<h3>${escapeHtml(section.title)}</h3><table><tbody>${section.rows.map(renderRow).join("")}</tbody></table>`;
}

const STYLE = `<style>.bb-static-receipt{max-width:56rem;margin:0 auto;padding:1.5rem 1rem}.bb-static-receipt table{border-collapse:collapse;width:100%;margin:0 0 1rem}.bb-static-receipt th,.bb-static-receipt td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid rgba(128,128,128,.35);vertical-align:top;overflow-wrap:anywhere}.bb-static-receipt th{width:14rem;font-weight:600}.bb-static-receipt pre{overflow-x:auto;padding:.75rem;border:1px solid rgba(128,128,128,.35)}</style>`;

export function renderReceiptMain(receipt: ResultReceipt): string {
  const summaries = receipt.summaryHrefs.map((entry) => `<a href="${escapeHtml(entry.href)}">${escapeHtml(entry.label)}</a>`).join(", ");
  return [
    `<main id="main" tabindex="-1" class="bb-explorer flex-1">`,
    `<article class="bb-static-receipt" data-static-result="${escapeHtml(receipt.resultId)}">`,
    `<h1>${escapeHtml(receipt.title)}</h1>`,
    `<p>${escapeHtml(receipt.headline)}. ${escapeHtml(receipt.rankingStatus)}.</p>`,
    receipt.derivedNotice === null ? "" : `<p><strong>${escapeHtml(receipt.derivedNotice)}</strong></p>`,
    `<section id="run-receipt" aria-label="Run receipt"><h2>Run receipt</h2>`,
    receipt.sections.map(renderSection).join(""),
    `</section>`,
    `<section id="cite" aria-label="Cite this result"><h2>Cite this result</h2><p>${escapeHtml(receipt.citeLine)}</p><pre><code>${escapeHtml(receipt.citationBlock)}</code></pre></section>`,
    `<p>Static summaries: ${summaries}. <a href="/result-summaries/">All result summaries</a>. This page is the plain-HTML form of the run receipt; with JavaScript it opens in the interactive <a href="/results/">Results Explorer</a>.</p>`,
    `</article>`,
    `</main>`,
  ].join("");
}

function replaceOnce(html: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(html)) throw new Error(`the Explorer index.html has no ${what}, so a result page cannot be derived from it`);
  return html.replace(pattern, () => replacement);
}

function setMeta(html: string, attribute: "name" | "property", name: string, content: string): string {
  const pattern = new RegExp(`<meta ${attribute}="${name}" content="[^"]*"\\s*/?>`);
  return replaceOnce(html, pattern, `<meta ${attribute}="${name}" content="${escapeHtml(content)}" />`, `${name} meta tag`);
}

export function renderReceiptPage(template: string, receipt: ResultReceipt, origin: string): string {
  const url = `${origin}${receiptPath(receipt.resultId)}`;
  const title = `${receipt.title} - BenchBox Results`;
  let html = template;
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`, "title");
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${escapeHtml(url)}" />`, "canonical link");
  html = setMeta(html, "name", "description", receipt.description);
  html = setMeta(html, "property", "og:title", title);
  html = setMeta(html, "property", "og:description", receipt.description);
  html = setMeta(html, "property", "og:url", url);
  html = setMeta(html, "name", "twitter:title", title);
  html = setMeta(html, "name", "twitter:description", receipt.description);
  html = replaceOnce(html, /<\/head>/, `${STYLE}</head>`, "head end");
  return replaceOnce(html, /<main id="main"[^>]*>[\s\S]*?<\/main>/, renderReceiptMain(receipt), "main element");
}
