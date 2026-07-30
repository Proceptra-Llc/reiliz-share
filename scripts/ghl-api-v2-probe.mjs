#!/usr/bin/env node
/**
 * HighLevel (GoHighLevel) API v2 probe.
 *
 * Answers three questions against a live location and saves every raw response:
 *
 *   1. Does GET /opportunities/search return populated custom fields?
 *   2. If not, does GET /opportunities/:id return them?
 *   3. Can custom field definitions be retrieved, including opportunity-model fields?
 *
 * Requires Node 18+ (built-in fetch). No dependencies.
 *
 * Credentials come from the environment and are never written to disk or stdout:
 *   GHL_PIT           Private Integration Token (or any v2 bearer token)
 *   GHL_LOCATION_ID   Location (sub-account) id to probe
 *
 * Usage:
 *   node scripts/ghl-api-v2-probe.mjs [options]
 *
 * Options:
 *   --out <dir>       Output directory            (default: ghl-probe-out)
 *   --limit <n>       Opportunities per page      (default: 20, max 100)
 *   --pages <n>       Search pages to walk        (default: 1)
 *   --details <n>     Opportunities to re-fetch   (default: 3)
 *   --opp-id <id>     Probe this opportunity id too (repeatable)
 *   --pipeline-id <id>  Restrict search to one pipeline
 *   --timeout <ms>    Per-request timeout         (default: 30000)
 *   --retries <n>     Retries on 429/5xx          (default: 3)
 *   --show-values     Print truncated field values to stdout (files always keep them)
 *   --help
 *
 * Output written to <out>/<run-timestamp>/:
 *   NN-<step>.body.json   raw response body, byte-for-byte as received
 *   NN-<step>.meta.json   request url, status, headers, timing
 *   summary.json          machine-readable findings
 *   README.txt            what the run did
 *
 * Saved bodies contain real CRM records. Keep the output directory out of git.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API_VERSION_HEADER = process.env.GHL_API_VERSION || '2021-07-28';
const API_BASE = (process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com').replace(/\/+$/, '');

const DEFAULTS = {
  out: 'ghl-probe-out',
  limit: 20,
  pages: 1,
  details: 3,
  timeout: 30000,
  retries: 3,
};

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = { ...DEFAULTS, oppId: [], pipelineId: null, showValues: false, help: false };
  const numeric = new Set(['limit', 'pages', 'details', 'timeout', 'retries']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) fail(`Unexpected argument: ${arg}`);

    const eq = arg.indexOf('=');
    const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
    const takeValue = () => {
      if (inlineValue !== null) return inlineValue;
      const next = argv[++i];
      if (next === undefined) fail(`Option --${arg.slice(2)} needs a value`);
      return next;
    };

    if (name === 'help') opts.help = true;
    else if (name === 'showValues') opts.showValues = true;
    else if (name === 'out') opts.out = takeValue();
    else if (name === 'oppId') opts.oppId.push(takeValue());
    else if (name === 'pipelineId') opts.pipelineId = takeValue();
    else if (numeric.has(name)) {
      const value = Number(takeValue());
      if (!Number.isFinite(value) || value < 0) fail(`Option --${name} must be a non-negative number`);
      opts[name] = value;
    } else fail(`Unknown option: ${arg}`);
  }

  opts.limit = Math.min(Math.max(opts.limit, 1), 100);
  return opts;
}

function fail(message) {
  console.error(`error: ${message}`);
  console.error('Run with --help for usage.');
  process.exit(2);
}

// ------------------------------------------------------------------- output

/** Redacts the bearer token in case an endpoint ever echoes it back. */
function makeRedactor(token) {
  if (!token || token.length < 8) return (text) => text;
  return (text) => text.split(token).join('[REDACTED_TOKEN]');
}

const INTERESTING_HEADERS = [
  'content-type',
  'x-ratelimit-limit-daily',
  'x-ratelimit-daily-remaining',
  'x-ratelimit-interval-milliseconds',
  'x-ratelimit-max',
  'x-ratelimit-remaining',
  'retry-after',
];

class Recorder {
  constructor(dir, redact) {
    this.dir = dir;
    this.redact = redact;
    this.n = 0;
    this.index = [];
  }

  async save(step, record) {
    this.n += 1;
    const prefix = `${String(this.n).padStart(2, '0')}-${step}`;
    const bodyFile = `${prefix}.body.json`;
    const metaFile = `${prefix}.meta.json`;

    await writeFile(join(this.dir, bodyFile), this.redact(record.bodyText ?? ''), 'utf8');
    await writeFile(
      join(this.dir, metaFile),
      JSON.stringify({ step, ...record, bodyText: undefined, bodyFile }, null, 2),
      'utf8',
    );

    this.index.push({ step, status: record.status, url: record.url, bodyFile, ms: record.ms });
    return { bodyFile, metaFile };
  }
}

// ------------------------------------------------------------------ request

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One HTTP call with retry on 429/5xx and a hard timeout. Never throws on an
 * HTTP error status — a 4xx is itself a finding worth recording.
 */
async function request(ctx, step, path, query = {}) {
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  let attempt = 0;
  for (;;) {
    const started = Date.now();
    let response;
    let bodyText = '';
    let networkError = null;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          Version: API_VERSION_HEADER,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(ctx.opts.timeout),
      });
      bodyText = await response.text();
    } catch (error) {
      networkError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }

    const ms = Date.now() - started;
    const status = response?.status ?? 0;
    const retryable = networkError !== null || status === 429 || status >= 500;

    if (retryable && attempt < ctx.opts.retries) {
      const retryAfter = Number(response?.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
      attempt += 1;
      console.log(`  ${step}: ${networkError ?? `HTTP ${status}`} — retry ${attempt}/${ctx.opts.retries} in ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    const headers = {};
    for (const name of INTERESTING_HEADERS) {
      const value = response?.headers.get(name);
      if (value !== null && value !== undefined) headers[name] = value;
    }

    let json = null;
    let parseError = null;
    if (bodyText) {
      try {
        json = JSON.parse(bodyText);
      } catch (error) {
        parseError = error.message;
      }
    }

    const record = {
      url: url.toString(),
      method: 'GET',
      versionHeader: API_VERSION_HEADER,
      status,
      ok: response?.ok ?? false,
      networkError,
      parseError,
      attempts: attempt + 1,
      ms,
      headers,
      bodyBytes: Buffer.byteLength(bodyText),
      bodyText,
    };

    const files = await ctx.recorder.save(step, record);
    const label = networkError ? networkError : `HTTP ${status}`;
    console.log(`  ${step}: ${label} (${ms}ms, ${record.bodyBytes}B) -> ${files.bodyFile}`);

    // Stay well inside the burst limit (100 requests / 10s).
    await sleep(150);
    return { ...record, json, bodyFile: files.bodyFile };
  }
}

// --------------------------------------------------- custom field inspection

const ID_KEYS = ['id', '_id', 'fieldId', 'customFieldId'];
const NAME_KEYS = ['key', 'fieldKey', 'name'];
const VALUE_KEYS = [
  'value',
  'fieldValue',
  'fieldValueString',
  'fieldValueArray',
  'fieldValueNumber',
  'fieldValueDate',
  'field_value',
  'values',
];

/** Normalizes one custom-field entry across the shapes HighLevel returns. */
function normalizeEntry(entry) {
  if (entry === null || typeof entry !== 'object') return { id: null, name: null, valueKey: null, value: entry };

  const id = ID_KEYS.map((k) => entry[k]).find((v) => v !== undefined) ?? null;
  const name = NAME_KEYS.map((k) => entry[k]).find((v) => v !== undefined) ?? null;

  let valueKey = VALUE_KEYS.find((k) => entry[k] !== undefined) ?? null;
  if (valueKey === null) {
    // Unknown shape: fall back to the first key that is not an identifier.
    valueKey = Object.keys(entry).find((k) => !ID_KEYS.includes(k) && !NAME_KEYS.includes(k)) ?? null;
  }

  return { id, name, valueKey, value: valueKey === null ? undefined : entry[valueKey] };
}

function isPopulated(value) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Pulls the custom-field block off an opportunity, whatever shape it takes. */
function inspectCustomFields(entity) {
  const containerKey = ['customFields', 'custom_fields', 'customField'].find((k) => entity?.[k] !== undefined);
  if (containerKey === undefined) return { keyPresent: false, containerKey: null, shape: 'absent', entries: [] };

  const raw = entity[containerKey];
  if (raw === null) return { keyPresent: true, containerKey, shape: 'null', entries: [] };

  let entries;
  let shape;
  if (Array.isArray(raw)) {
    shape = raw.length === 0 ? 'empty-array' : 'array';
    entries = raw.map(normalizeEntry);
  } else if (typeof raw === 'object') {
    const pairs = Object.entries(raw);
    shape = pairs.length === 0 ? 'empty-object' : 'object-map';
    entries = pairs.map(([id, value]) => normalizeEntry({ id, value }));
  } else {
    shape = typeof raw;
    entries = [];
  }

  return { keyPresent: true, containerKey, shape, entries };
}

function summarizeOpportunity(opportunity) {
  const inspection = inspectCustomFields(opportunity);
  const populated = inspection.entries.filter((e) => isPopulated(e.value));
  return {
    id: opportunity?.id ?? opportunity?._id ?? null,
    name: opportunity?.name ?? null,
    keyPresent: inspection.keyPresent,
    containerKey: inspection.containerKey,
    shape: inspection.shape,
    entryCount: inspection.entries.length,
    populatedCount: populated.length,
    entries: inspection.entries,
  };
}

function rollUp(summaries) {
  const ids = new Set();
  for (const summary of summaries) {
    for (const entry of summary.entries) if (isPopulated(entry.value) && entry.id) ids.add(String(entry.id));
  }
  return {
    opportunities: summaries.length,
    withKey: summaries.filter((s) => s.keyPresent).length,
    withEntries: summaries.filter((s) => s.entryCount > 0).length,
    withPopulated: summaries.filter((s) => s.populatedCount > 0).length,
    shapes: [...new Set(summaries.map((s) => s.shape))],
    distinctPopulatedFieldIds: [...ids],
  };
}

function truncate(value, max = 60) {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// -------------------------------------------------------------------- probes

/** Reads the opportunity array out of a search response, whatever it is called. */
function extractOpportunities(json) {
  for (const key of ['opportunities', 'opportunity', 'data', 'items']) {
    if (Array.isArray(json?.[key])) return json[key];
  }
  return [];
}

async function probeSearch(ctx) {
  console.log('\n[1] GET /opportunities/search');

  const baseQuery = {
    location_id: ctx.locationId,
    limit: ctx.opts.limit,
    pipeline_id: ctx.opts.pipelineId ?? undefined,
  };

  let response = await request(ctx, 'opportunities-search-page1', '/opportunities/search', baseQuery);

  // Older docs spell the parameter locationId; try it before giving up.
  let paramUsed = 'location_id';
  if (!response.ok) {
    console.log('  retrying with locationId spelling');
    response = await request(ctx, 'opportunities-search-page1-locationId', '/opportunities/search', {
      locationId: ctx.locationId,
      limit: ctx.opts.limit,
      pipelineId: ctx.opts.pipelineId ?? undefined,
    });
    paramUsed = 'locationId';
  }

  const pages = [response];
  if (response.ok) {
    for (let page = 2; page <= ctx.opts.pages; page++) {
      const previous = pages[pages.length - 1];
      const meta = previous.json?.meta ?? {};
      if (!meta.startAfterId && !meta.startAfter) break;
      pages.push(
        await request(ctx, `opportunities-search-page${page}`, '/opportunities/search', {
          ...(paramUsed === 'location_id' ? baseQuery : { locationId: ctx.locationId, limit: ctx.opts.limit }),
          startAfterId: meta.startAfterId,
          startAfter: meta.startAfter,
        }),
      );
    }
  }

  const opportunities = pages.flatMap((page) => extractOpportunities(page.json));
  const summaries = opportunities.map(summarizeOpportunity);
  const first = pages[0];

  const result = {
    endpoint: '/opportunities/search',
    locationParam: paramUsed,
    ok: pages.every((p) => p.ok),
    status: first.status,
    error: first.ok ? null : first.json ?? first.bodyText?.slice(0, 500) ?? null,
    pagesFetched: pages.length,
    reportedTotal: first.json?.meta?.total ?? first.json?.total ?? null,
    topLevelKeys: first.json && typeof first.json === 'object' ? Object.keys(first.json) : [],
    opportunityKeys: opportunities[0] && typeof opportunities[0] === 'object' ? Object.keys(opportunities[0]) : [],
    rollup: rollUp(summaries),
    perOpportunity: summaries,
    files: pages.map((p) => p.bodyFile),
  };

  if (!result.ok) {
    console.log(`  search failed: ${JSON.stringify(result.error).slice(0, 300)}`);
    return result;
  }

  const r = result.rollup;
  console.log(`  ${r.opportunities} opportunities returned (reported total: ${result.reportedTotal ?? 'n/a'})`);
  console.log(`  customFields key present on ${r.withKey}/${r.opportunities}, shapes: ${r.shapes.join(', ') || 'n/a'}`);
  console.log(`  with >=1 entry: ${r.withEntries}, with >=1 populated value: ${r.withPopulated}`);
  return result;
}

async function probeDetail(ctx, searchResult) {
  console.log('\n[2] GET /opportunities/:id');

  // Prefer ids that came back without populated custom fields — those are the
  // ones where a detail fetch would actually tell us something new.
  const fromSearch = [...searchResult.perOpportunity]
    .sort((a, b) => a.populatedCount - b.populatedCount)
    .map((s) => s.id)
    .filter(Boolean);
  const ids = [...new Set([...ctx.opts.oppId, ...fromSearch])].slice(0, Math.max(ctx.opts.details, ctx.opts.oppId.length));

  if (ids.length === 0) {
    console.log('  no opportunity ids available — skipped');
    return { endpoint: '/opportunities/:id', skipped: true, reason: 'no opportunity ids available', probed: [] };
  }

  const probed = [];
  for (const id of ids) {
    const response = await request(ctx, `opportunity-detail-${id}`, `/opportunities/${encodeURIComponent(id)}`);
    const entity = response.json?.opportunity ?? response.json?.data ?? response.json;
    const summary = response.ok ? summarizeOpportunity(entity) : null;
    const searchSummary = searchResult.perOpportunity.find((s) => s.id === id) ?? null;

    probed.push({
      id,
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : response.json ?? response.bodyText?.slice(0, 500) ?? null,
      entityKeys: entity && typeof entity === 'object' ? Object.keys(entity) : [],
      detail: summary,
      searchPopulatedCount: searchSummary?.populatedCount ?? null,
      revealsMore: summary !== null && searchSummary !== null && summary.populatedCount > searchSummary.populatedCount,
      file: response.bodyFile,
    });

    if (summary) {
      const delta = searchSummary === null ? 'not in search set' : `search had ${searchSummary.populatedCount}`;
      console.log(`  ${id}: ${summary.populatedCount} populated of ${summary.entryCount} entries (${delta})`);
    }
  }

  const successful = probed.filter((p) => p.ok);
  return {
    endpoint: '/opportunities/:id',
    skipped: false,
    probed,
    anyPopulated: successful.some((p) => p.detail?.populatedCount > 0),
    anyRevealsMore: successful.some((p) => p.revealsMore),
  };
}

/** Reads the definition array out of a custom-fields response. */
function extractDefinitions(json) {
  for (const key of ['customFields', 'customField', 'fields', 'data']) {
    if (Array.isArray(json?.[key])) return json[key];
  }
  return Array.isArray(json) ? json : [];
}

async function probeDefinitions(ctx) {
  console.log('\n[3] custom field definitions');

  const attempts = [
    {
      step: 'customfields-model-opportunity',
      path: `/locations/${encodeURIComponent(ctx.locationId)}/customFields`,
      query: { model: 'opportunity' },
      label: 'GET /locations/:id/customFields?model=opportunity',
    },
    {
      step: 'customfields-model-contact',
      path: `/locations/${encodeURIComponent(ctx.locationId)}/customFields`,
      query: { model: 'contact' },
      label: 'GET /locations/:id/customFields?model=contact',
    },
    {
      step: 'customfields-model-all',
      path: `/locations/${encodeURIComponent(ctx.locationId)}/customFields`,
      query: { model: 'all' },
      label: 'GET /locations/:id/customFields?model=all',
    },
    {
      step: 'customfields-no-model',
      path: `/locations/${encodeURIComponent(ctx.locationId)}/customFields`,
      query: {},
      label: 'GET /locations/:id/customFields (no model param)',
    },
    {
      step: 'customfields-objectkey-opportunity',
      path: '/custom-fields/object-key/opportunity',
      query: { locationId: ctx.locationId },
      label: 'GET /custom-fields/object-key/opportunity (exploratory)',
    },
  ];

  const results = [];
  for (const attempt of attempts) {
    const response = await request(ctx, attempt.step, attempt.path, attempt.query);
    const definitions = response.ok ? extractDefinitions(response.json) : [];
    const byModel = {};
    for (const definition of definitions) {
      const model = definition?.model ?? definition?.objectKey ?? 'unspecified';
      byModel[model] = (byModel[model] ?? 0) + 1;
    }

    results.push({
      label: attempt.label,
      step: attempt.step,
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : response.json ?? response.bodyText?.slice(0, 300) ?? null,
      count: definitions.length,
      byModel,
      definitions: definitions.map((d) => ({
        id: d?.id ?? d?._id ?? null,
        name: d?.name ?? null,
        fieldKey: d?.fieldKey ?? d?.key ?? null,
        dataType: d?.dataType ?? d?.type ?? null,
        model: d?.model ?? d?.objectKey ?? null,
      })),
      file: response.bodyFile,
    });

    if (response.ok) {
      const models = Object.entries(byModel).map(([m, c]) => `${m}:${c}`).join(', ') || 'none';
      console.log(`  ${attempt.label} -> ${definitions.length} definitions (${models})`);
    }
  }

  return { attempts: results, anyOk: results.some((r) => r.ok) };
}

// ------------------------------------------------------------------- verdict

function crossReference(definitionsResult, searchResult, detailResult) {
  const known = new Map();
  for (const attempt of definitionsResult.attempts) {
    for (const definition of attempt.definitions) {
      if (definition.id && !known.has(definition.id)) known.set(String(definition.id), definition);
    }
  }

  const seen = new Map();
  const note = (summaries, source) => {
    for (const summary of summaries ?? []) {
      for (const entry of summary?.entries ?? []) {
        if (!entry.id) continue;
        const id = String(entry.id);
        const record = seen.get(id) ?? { id, sources: new Set(), populatedIn: new Set(), sampleValue: undefined };
        record.sources.add(source);
        if (isPopulated(entry.value)) {
          record.populatedIn.add(source);
          if (record.sampleValue === undefined) record.sampleValue = entry.value;
        }
        seen.set(id, record);
      }
    }
  };

  note(searchResult.perOpportunity, 'search');
  note(detailResult.probed?.map((p) => p.detail).filter(Boolean), 'detail');

  return [...seen.values()].map((record) => {
    const definition = known.get(record.id) ?? null;
    return {
      id: record.id,
      name: definition?.name ?? null,
      fieldKey: definition?.fieldKey ?? null,
      dataType: definition?.dataType ?? null,
      model: definition?.model ?? null,
      definitionFound: definition !== null,
      seenIn: [...record.sources],
      populatedIn: [...record.populatedIn],
      sampleValue: record.sampleValue,
    };
  });
}

function buildVerdicts(searchResult, detailResult, definitionsResult) {
  const search = !searchResult.ok
    ? { answer: 'ERROR', detail: `search returned HTTP ${searchResult.status}` }
    : searchResult.rollup.opportunities === 0
      ? { answer: 'UNKNOWN', detail: 'search returned zero opportunities — nothing to inspect' }
      : searchResult.rollup.withPopulated === searchResult.rollup.opportunities
        ? { answer: 'YES', detail: 'every opportunity carried at least one populated custom field' }
        : searchResult.rollup.withPopulated > 0
          ? {
              answer: 'PARTIAL',
              detail: `${searchResult.rollup.withPopulated}/${searchResult.rollup.opportunities} opportunities carried a populated custom field`,
            }
          : searchResult.rollup.withKey === 0
            ? { answer: 'NO', detail: 'no customFields key on any opportunity in the search response' }
            : { answer: 'NO', detail: `customFields present but empty (shapes: ${searchResult.rollup.shapes.join(', ')})` };

  const successfulDetails = detailResult.probed?.filter((p) => p.ok) ?? [];
  const detail = detailResult.skipped
    ? { answer: 'UNKNOWN', detail: detailResult.reason }
    : successfulDetails.length === 0
      ? { answer: 'ERROR', detail: 'every detail fetch failed' }
      : detailResult.anyRevealsMore
        ? { answer: 'YES', detail: 'detail fetch returned custom field values the search response omitted' }
        : detailResult.anyPopulated
          ? { answer: 'YES', detail: 'detail fetch returned populated custom fields (search returned them too)' }
          : { answer: 'NO', detail: 'detail fetch returned no populated custom fields either' };

  const opportunityModel = definitionsResult.attempts.some(
    (a) => a.ok && (a.byModel.opportunity > 0 || a.byModel.opportunities > 0),
  );
  const definitions = !definitionsResult.anyOk
    ? { answer: 'NO', detail: 'no custom-field definition endpoint returned success' }
    : opportunityModel
      ? { answer: 'YES', detail: 'definitions retrieved and include opportunity-model fields' }
      : { answer: 'PARTIAL', detail: 'definitions retrieved but none carry the opportunity model' };

  return { searchReturnsCustomFields: search, detailReturnsCustomFields: detail, definitionsRetrievable: definitions };
}

// ---------------------------------------------------------------------- main

const HELP = `HighLevel API v2 probe

  node scripts/ghl-api-v2-probe.mjs [--out dir] [--limit n] [--pages n]
                                    [--details n] [--opp-id id] [--pipeline-id id]
                                    [--timeout ms] [--retries n] [--show-values]

Environment:
  GHL_PIT          Private Integration Token (required)
  GHL_LOCATION_ID  Location id to probe (required)
  GHL_API_BASE     Override API base URL (default https://services.leadconnectorhq.com)
  GHL_API_VERSION  Override Version header (default 2021-07-28)
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  const token = process.env.GHL_PIT;
  const locationId = process.env.GHL_LOCATION_ID;
  const missing = [!token && 'GHL_PIT', !locationId && 'GHL_LOCATION_ID'].filter(Boolean);
  if (missing.length > 0) {
    console.error(`error: missing required environment variable(s): ${missing.join(', ')}`);
    console.error('\n' + HELP);
    return 2;
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(opts.out, runId);
  await mkdir(dir, { recursive: true });

  const ctx = { token, locationId, opts, recorder: new Recorder(dir, makeRedactor(token)) };

  console.log(`HighLevel API v2 probe`);
  console.log(`  base:     ${API_BASE}`);
  console.log(`  version:  ${API_VERSION_HEADER}`);
  console.log(`  location: ${locationId}`);
  console.log(`  output:   ${dir}`);

  const searchResult = await probeSearch(ctx);
  const detailResult = await probeDetail(ctx, searchResult);
  const definitionsResult = await probeDefinitions(ctx);

  const fieldMap = crossReference(definitionsResult, searchResult, detailResult);
  const verdicts = buildVerdicts(searchResult, detailResult, definitionsResult);

  const summary = {
    runId,
    apiBase: API_BASE,
    versionHeader: API_VERSION_HEADER,
    locationId,
    options: { ...opts, oppId: opts.oppId },
    verdicts,
    search: searchResult,
    detail: detailResult,
    definitions: definitionsResult,
    fieldMap,
    responses: ctx.recorder.index,
  };

  await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await writeFile(
    join(dir, 'README.txt'),
    [
      `HighLevel API v2 probe — ${runId}`,
      `location: ${locationId}`,
      `base: ${API_BASE}  version header: ${API_VERSION_HEADER}`,
      '',
      'Files:',
      '  NN-<step>.body.json  raw response body as received',
      '  NN-<step>.meta.json  url, status, selected headers, timing',
      '  summary.json         parsed findings and verdicts',
      '',
      'These bodies contain live CRM records. Do not commit them.',
      '',
    ].join('\n'),
    'utf8',
  );

  // -------------------------------------------------------------- report

  console.log('\n' + '='.repeat(72));
  console.log('FINDINGS');
  console.log('='.repeat(72));
  console.log(`1. /opportunities/search returns populated custom fields?  ${verdicts.searchReturnsCustomFields.answer}`);
  console.log(`   ${verdicts.searchReturnsCustomFields.detail}`);
  console.log(`2. /opportunities/:id returns populated custom fields?     ${verdicts.detailReturnsCustomFields.answer}`);
  console.log(`   ${verdicts.detailReturnsCustomFields.detail}`);
  console.log(`3. Custom field definitions retrievable?                   ${verdicts.definitionsRetrievable.answer}`);
  console.log(`   ${verdicts.definitionsRetrievable.detail}`);

  const workingDefinitionEndpoints = definitionsResult.attempts.filter((a) => a.ok);
  if (workingDefinitionEndpoints.length > 0) {
    console.log('\nDefinition endpoints that worked:');
    for (const attempt of workingDefinitionEndpoints) {
      console.log(`  ${attempt.label} -> ${attempt.count} field(s)`);
    }
  }
  const failedDefinitionEndpoints = definitionsResult.attempts.filter((a) => !a.ok);
  if (failedDefinitionEndpoints.length > 0) {
    console.log('\nDefinition endpoints that failed:');
    for (const attempt of failedDefinitionEndpoints) {
      console.log(`  ${attempt.label} -> HTTP ${attempt.status} ${truncate(attempt.error, 120)}`);
    }
  }

  if (fieldMap.length > 0) {
    console.log('\nCustom field ids observed on opportunities:');
    for (const field of fieldMap) {
      const name = field.name ?? '(no matching definition)';
      const where = field.populatedIn.length > 0 ? `populated in ${field.populatedIn.join('+')}` : 'never populated';
      const value = opts.showValues && field.sampleValue !== undefined ? `  e.g. ${truncate(field.sampleValue)}` : '';
      console.log(`  ${field.id}  ${name}  [${field.dataType ?? '?'}/${field.model ?? '?'}]  ${where}${value}`);
    }
  }

  console.log(`\nRaw responses: ${dir}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('\nfatal:', error?.stack ?? error);
    process.exit(1);
  });
