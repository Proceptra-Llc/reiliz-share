# Scripts

Standalone diagnostic utilities. No dependencies; Node 18+.

## `ghl-api-v2-probe.mjs`

Probes the HighLevel (GoHighLevel) API v2 for a single location and reports what
opportunity custom-field data is actually retrievable. It answers three questions
and saves every raw response for inspection:

1. Does `GET /opportunities/search` return populated custom fields?
2. If not, does `GET /opportunities/:id` return them?
3. Can custom field definitions be retrieved, including opportunity-model fields?

```bash
export GHL_PIT=…            # Private Integration Token
export GHL_LOCATION_ID=…    # location (sub-account) id
node scripts/ghl-api-v2-probe.mjs --limit 20 --details 3
```

Run `--help` for all options. Credentials are read from the environment only — they
are never logged, and the token is redacted from saved bodies if an endpoint echoes
it back.

Output lands in `ghl-probe-out/<timestamp>/`: the raw body and a request/status/timing
sidecar per call, plus `summary.json` with parsed findings and verdicts. Those bodies
contain live CRM records, so the directory is gitignored and must stay that way per
[`docs/SANITIZATION-CHECKLIST.md`](../docs/SANITIZATION-CHECKLIST.md).
