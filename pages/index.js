import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Search,
} from "lucide-react";

/* -------------------- tiny inline UI primitives -------------------- */
const Card = ({ className = "", ...props }) => (
  <div className={className} style={{ border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }} {...props} />
);
const CardContent = ({ className = "", ...props }) => (
  <div className={className} style={{ padding: 16 }} {...props} />
);
const Button = ({ className = "", variant = "primary", ...props }) => {
  const styles = {
    primary: { background: "#0f172a", color: "#fff", border: "none" },
    secondary: { background: "#1d4ed8", color: "#fff", border: "none" },
    outline: { background: "#fff", color: "#0f172a", border: "1px solid #cbd5e1" },
    ghost: { background: "transparent", color: "#0f172a", border: "1px solid transparent" },
  };
  const s = styles[variant] || styles.primary;
  return (
    <button
      className={className}
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        border: s.border,
        background: s.background,
        color: s.color,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.55 : 1,
        display: "inline-flex",
        alignItems: "center",
        fontSize: 14,
      }}
      {...props}
    />
  );
};
const Input = ({ className = "", ...props }) => (
  <input className={className} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", width: "100%" }} {...props} />
);
const Label = ({ className = "", ...props }) => (
  <label className={className} style={{ fontSize: 14, fontWeight: 500 }} {...props} />
);
const Badge = ({ className = "", children, tone = "slate" }) => {
  const tones = {
    slate: { bg: "#e2e8f0", fg: "#0f172a" },
    emerald: { bg: "#d1fae5", fg: "#065f46" },
    rose: { bg: "#ffe4e6", fg: "#9f1239" },
    amber: { bg: "#fef3c7", fg: "#92400e" },
    blue: { bg: "#dbeafe", fg: "#1e40af" },
  };
  const t = tones[tone] || tones.slate;
  return <span className={className} style={{ padding: "2px 10px", borderRadius: 999, background: t.bg, color: t.fg, fontSize: 12, fontWeight: 500 }}>{children}</span>;
};

/* -------------------- helpers -------------------- */
const DEFAULTS = { pageNumber: 1, pageSize: 50, throttleMs: 1200 };

function buildBaseUrl(portalName, environment) {
  const portal = String(portalName || "").trim().toLowerCase();
  const env = String(environment || "").trim().toLowerCase();
  if (!portal || !env) return "";
  if (env === "pilot") return `https://${portal}-pilot.csod.com`;
  if (env === "stage") return `https://${portal}-stg.csod.com`;
  if (env === "production") return `https://${portal}.csod.com`;
  return "";
}

function normalizeJobsResponse(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.jobs)) return payload.jobs;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}
function extractJobId(job) { return job?.job_id ?? job?.jobId ?? job?.id ?? job?.jobID ?? null; }
function extractJobLabel(job) {
  return job?.label ?? job?.job_label ?? job?.name ?? job?.title ?? "";
}
// Walks any object/array recursively and picks the first non-empty value for any of the given keys.
function deepFind(obj, keys, seen = new Set()) {
  if (obj == null || typeof obj !== "object" || seen.has(obj)) return undefined;
  seen.add(obj);
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const v = deepFind(item, keys, seen);
      if (v !== undefined) return v;
    }
  } else {
    for (const val of Object.values(obj)) {
      if (val && typeof val === "object") {
        const v = deepFind(val, keys, seen);
        if (v !== undefined) return v;
      }
    }
  }
  return undefined;
}

// Finds the best "import object" to draw the execution summary from.
// Covers: response.import, response.imports[0], response.data.imports[0], response.job.imports[0], top-level with import_id, etc.
function findImportObject(details) {
  if (!details || typeof details !== "object") return null;
  const candidates = [];
  const push = (v) => { if (v && typeof v === "object") candidates.push(v); };

  push(details.import);
  push(details?.data?.import);
  push(details?.job?.import);
  if (Array.isArray(details.imports) && details.imports.length) push(details.imports[0]);
  if (Array.isArray(details?.data?.imports) && details.data.imports.length) push(details.data.imports[0]);
  if (Array.isArray(details?.job?.imports) && details.job.imports.length) push(details.job.imports[0]);
  push(details);
  push(details.data);
  push(details.job);

  for (const c of candidates) {
    if (
      c.import_id != null || c.importId != null ||
      c.total_records != null || c.totalRecords != null ||
      c.success_count != null || c.successCount != null
    ) return c;
  }
  return candidates[0] || null;
}

function extractImportId(details) {
  return deepFind(details, ["import_id", "importId", "importID", "ImportId", "ImportID"]) ?? null;
}

function extractExecutionSummary(details) {
  const src = findImportObject(details) || details || {};
  return {
    import_id: extractImportId(details),
    total_records: Number(
      deepFind(src, ["total_records", "totalRecords", "total"]) ??
      deepFind(details, ["total_records", "totalRecords", "total"]) ?? 0
    ),
    success_count: Number(
      deepFind(src, ["success_count", "successCount", "success"]) ??
      deepFind(details, ["success_count", "successCount", "success"]) ?? 0
    ),
    warning_count: Number(
      deepFind(src, ["warning_count", "warningCount", "warnings"]) ??
      deepFind(details, ["warning_count", "warningCount", "warnings"]) ?? 0
    ),
    error_count: Number(
      deepFind(src, ["error_count", "errorCount", "errors"]) ??
      deepFind(details, ["error_count", "errorCount", "errors"]) ?? 0
    ),
  };
}
function fileNameSafe(value) { return String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_"); }
function sleep(ms) { return new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0))); }

function base64ToBlob(base64, contentType) {
  const byteChars = atob(base64 || "");
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i += 1) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: contentType || "text/csv" });
}

async function callProxy(body) {
  const res = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!payload.ok) {
    const err = new Error(payload.error || `Upstream ${payload.status} ${payload.statusText || ""}`.trim());
    err.status = payload.status;
    err.statusText = payload.statusText;
    err.body = payload.body;
    throw err;
  }
  return payload;
}

/* -------------------- component -------------------- */
export default function App() {
  // Inputs — portal_name empty by default (spec)
  const [portalName, setPortalName] = useState("");
  const [environment, setEnvironment] = useState("pilot");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [pageNumber, setPageNumber] = useState(DEFAULTS.pageNumber);
  const [pageSize, setPageSize] = useState(DEFAULTS.pageSize);
  const [throttleMs, setThrottleMs] = useState(DEFAULTS.throttleMs);

  // Step 1 output — job list (job_id + label ONLY)
  const [jobs, setJobs] = useState([]); // [{ job_id, label }]
  const [phase1Meta, setPhase1Meta] = useState(null); // { page_number, page_size }
  const [phase1Running, setPhase1Running] = useState(false);

  // Per-job expansion + lazy-loaded import details
  // jobState[job_id] = { open, loadingDetails, detailsError, import: {...} | null, downloading, downloadError }
  const [jobState, setJobState] = useState({});

  // Simple global throttle gate — ensures at least `throttleMs` between ANY two upstream calls
  const lastCallAtRef = useRef(0);

  // Log stream
  const [logs, setLogs] = useState([]);
  const addLog = (level, step, message, meta = {}) => {
    setLogs((current) => [{ ts: new Date().toISOString(), level, step, message, ...meta }, ...current]);
  };

  const computedBaseUrl = useMemo(() => buildBaseUrl(portalName, environment), [portalName, environment]);
  const phase1Ready = portalName.trim() && fromDate && toDate && bearerToken.trim() && computedBaseUrl;

  // Global throttle: waits so this call happens at least `throttleMs` after the previous one.
  async function throttleGate(step) {
    const now = Date.now();
    const gap = now - (lastCallAtRef.current || 0);
    const wait = Math.max(0, Number(throttleMs || 0) - gap);
    if (wait > 0) {
      addLog("info", step, `Throttling ${wait} ms before next API call (429 protection).`);
      await sleep(wait);
    }
    lastCallAtRef.current = Date.now();
  }

  function updateJobState(jobId, patch) {
    setJobState((prev) => ({ ...prev, [jobId]: { ...(prev[jobId] || {}), ...patch } }));
  }

  /* ---------- STEP 1: initial job list ---------- */
  async function fetchJobsStep1() {
    setPhase1Running(true);
    setJobs([]);
    setJobState({});
    setPhase1Meta(null);
    try {
      if (!portalName.trim()) { addLog("error", "Validation", "Portal name is required."); return; }
      if (!fromDate || !toDate) { addLog("error", "Validation", "From and To dates are required."); return; }
      if (!bearerToken.trim()) { addLog("error", "Validation", "Bearer token is required."); return; }
      if (!computedBaseUrl) { addLog("error", "Validation", "Unable to construct base URL."); return; }

      await throttleGate("Step 1");
      addLog("info", "Step 1", `Fetching jobs (page ${pageNumber}, size ${pageSize})…`);

      const payload = await callProxy({
        baseUrl: computedBaseUrl,
        path: "/services/api/x/bulk-api/v1/jobs",
        bearerToken,
        query: {
          job_create_from_date: fromDate,
          job_create_to_date: toDate,
          page_number: pageNumber,
          page_size: pageSize,
        },
        expectBlob: false,
      });

      const raw = normalizeJobsResponse(payload.body);
      const list = raw
        .map((j) => ({ job_id: extractJobId(j), label: extractJobLabel(j) }))
        .filter((j) => j.job_id);

      setPhase1Meta({ page_number: pageNumber, page_size: pageSize });

      if (list.length === 0) {
        addLog("info", "Step 1", "No jobs found for the selected date range.");
        return;
      }

      setJobs(list);
      addLog("success", "Step 1", `Retrieved ${list.length} job(s). Expand a row to lazy-load its import details.`, {
        status: payload.status,
        statusText: payload.statusText,
      });
    } catch (error) {
      if (error.status === 429) {
        addLog("error", "Step 1", "429 Too Many Requests — try increasing the throttle delay.", { status: 429 });
      } else {
        addLog("error", "Step 1", `Failed to retrieve jobs: ${error.message}`, { status: error.status, statusText: error.statusText });
      }
    } finally {
      setPhase1Running(false);
    }
  }

  /* ---------- STEP 2: lazy-load job details for one row ---------- */
  async function loadJobDetails(job) {
    const jobId = job.job_id;
    const current = jobState[jobId] || {};
    if (current.loadingDetails || current.import) return; // don't refetch
    updateJobState(jobId, { loadingDetails: true, detailsError: "" });

    try {
      await throttleGate("Step 2");
      addLog("info", "Step 2", `Lazy-loading details for job_id ${jobId}…`);
      const payload = await callProxy({
        baseUrl: computedBaseUrl,
        path: `/services/api/x/bulk-api/v1/jobs/${encodeURIComponent(jobId)}`,
        bearerToken,
        query: {},
        expectBlob: false,
      });
      const metrics = extractExecutionSummary(payload.body);
      if (!metrics.import_id) {
        let preview = "";
        try { preview = JSON.stringify(payload.body, null, 2).slice(0, 2000); }
        catch (_) { preview = String(payload.body).slice(0, 2000); }
        updateJobState(jobId, {
          loadingDetails: false,
          detailsError: "No import_id found in job details response. See raw response below.",
          rawPreview: preview,
        });
        addLog("warning", "Step 2", `import_id missing for job_id ${jobId}. Raw preview shown inline.`);
        return;
      }
      updateJobState(jobId, {
        loadingDetails: false,
        detailsError: "",
        import: {
          import_id: metrics.import_id,
          total_records: metrics.total_records,
          success_count: metrics.success_count,
          warning_count: metrics.warning_count,
          error_count: metrics.error_count,
        },
      });
      addLog("success", "Step 2", `Import ${metrics.import_id} loaded for job_id ${jobId}.`, {
        status: payload.status,
        import_id: metrics.import_id,
      });
    } catch (error) {
      const msg = error.status === 429 ? "429 Too Many Requests — increase the throttle delay." : error.message;
      updateJobState(jobId, { loadingDetails: false, detailsError: msg });
      addLog("error", "Step 2", `Failed for job_id ${jobId}: ${msg}`, { status: error.status });
    }
  }

  // Toggle expand/collapse; lazy-load on first expand
  async function toggleJob(job) {
    const jobId = job.job_id;
    const current = jobState[jobId] || {};
    const nextOpen = !current.open;
    updateJobState(jobId, { open: nextOpen });
    if (nextOpen && !current.import && !current.loadingDetails) {
      await loadJobDetails(job);
    }
  }

  /* ---------- STEP 3: CSV report per import ---------- */
  async function downloadCsv(job) {
    const jobId = job.job_id;
    const state = jobState[jobId] || {};
    const importId = state.import?.import_id;
    if (!importId) return;
    updateJobState(jobId, { downloading: true, downloadError: "" });
    try {
      await throttleGate("Step 3");
      addLog("info", "Step 3", `Generating CSV for import_id ${importId}…`);
      const payload = await callProxy({
        baseUrl: computedBaseUrl,
        path: `/services/api/x/bulk-api/v1/imports/${encodeURIComponent(importId)}/report`,
        bearerToken,
        query: {},
        expectBlob: true,
      });
      const blob = base64ToBlob(payload.base64, payload.contentType || "text/csv");
      const objectUrl = URL.createObjectURL(blob);
      const filename = `bulk_import_report_job_${fileNameSafe(jobId)}_import_${fileNameSafe(importId)}.csv`;
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      updateJobState(jobId, { downloading: false, downloadError: "" });
      addLog("success", "Step 3", `CSV downloaded: ${filename}`, { status: payload.status });
    } catch (error) {
      const msg = error.status === 429 ? "429 Too Many Requests — increase the throttle delay." : error.message;
      updateJobState(jobId, { downloading: false, downloadError: msg });
      addLog("error", "Step 3", `CSV download failed: ${msg}`, { status: error.status });
    }
  }

  /* -------------------- render -------------------- */
  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-semibold tracking-tight">Cornerstone Bulk API — Lazy, Rate-Safe Workflow</h1>
          <p className="mt-2 text-sm text-slate-600">
            Step 1 lists jobs (job_id + label only). Expanding a row lazy-loads its import details (Step 2). Click "Download CSV" to fetch the report (Step 3). A throttle gate prevents 429s.
          </p>
        </motion.div>

        {/* Inputs */}
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="grid gap-4 p-5 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Portal Name</Label>
              <Input
                value={portalName}
                onChange={(e) => setPortalName(e.target.value)}
                placeholder="Enter portal name (e.g. cornerstone)"
                disabled={phase1Running}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label>Environment</Label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                disabled={phase1Running}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
              >
                <option value="pilot">Pilot</option>
                <option value="stage">Stage</option>
                <option value="production">Production</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Base URL</Label>
              <Input value={computedBaseUrl} readOnly style={{ backgroundColor: "#f8fafc", color: "#475569", padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", width: "100%" }} />
            </div>
            <div className="space-y-2">
              <Label>Job Create From Date</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={phase1Running} />
            </div>
            <div className="space-y-2">
              <Label>Job Create To Date</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={phase1Running} />
            </div>
            <div className="space-y-2">
              <Label>Page Number</Label>
              <Input type="number" min="1" value={pageNumber} onChange={(e) => setPageNumber(e.target.value)} disabled={phase1Running} />
            </div>
            <div className="space-y-2">
              <Label>Page Size</Label>
              <Input type="number" min="1" max="100" value={pageSize} onChange={(e) => setPageSize(e.target.value)} disabled={phase1Running} />
            </div>
            <div className="space-y-2">
              <Label>Throttle Delay (ms, 429-protection)</Label>
              <Input type="number" min="0" step="100" value={throttleMs} onChange={(e) => setThrottleMs(e.target.value)} disabled={phase1Running} />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label>Bearer Token</Label>
              <Input type="password" placeholder="Paste OAuth access token" value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} disabled={phase1Running} autoComplete="off" />
            </div>
          </CardContent>
        </Card>

        {/* Step 1 controls + job list (nested-list rendering) */}
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Step 1 — Jobs</h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {phase1Meta && <Badge tone="blue">page {phase1Meta.page_number} / size {phase1Meta.page_size}</Badge>}
                <Badge>{jobs.length} job(s)</Badge>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Button onClick={fetchJobsStep1} disabled={!phase1Ready || phase1Running}>
                {phase1Running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Fetch Jobs
              </Button>
              <span style={{ fontSize: 12, color: "#64748b" }}>
                Tip: click a job_id below to load its import details (throttled to avoid 429).
              </span>
            </div>

            {/* Nested-list rendering: Job → (click) → nested import list */}
            {jobs.length > 0 && (
              <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {jobs.map((job) => {
                  const state = jobState[job.job_id] || {};
                  const isOpen = !!state.open;
                  return (
                    <li key={job.job_id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", overflow: "hidden" }}>
                      {/* Clickable job header */}
                      <button
                        onClick={() => toggleJob(job)}
                        style={{
                          width: "100%",
                          background: isOpen ? "#f1f5f9" : "#fff",
                          border: "none",
                          padding: "10px 14px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span style={{ fontWeight: 600, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{job.job_id}</span>
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            {job.label ? `— ${job.label}` : <em style={{ color: "#94a3b8" }}>no label</em>}
                          </span>
                        </span>
                        <span>
                          {state.loadingDetails && <Badge tone="blue">Loading…</Badge>}
                          {state.detailsError && <Badge tone="rose">Error</Badge>}
                          {state.import && !state.detailsError && !state.loadingDetails && <Badge tone="emerald">Import loaded</Badge>}
                        </span>
                      </button>

                      {/* Nested list rendered directly under this job_id */}
                      {isOpen && (
                        <ul style={{ listStyle: "none", margin: 0, padding: "10px 14px 14px 44px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 8 }}>
                          {state.loadingDetails && (
                            <li style={{ color: "#475569", fontSize: 14, display: "inline-flex", alignItems: "center" }}>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lazy-loading import details…
                            </li>
                          )}

                          {state.detailsError && (
                            <li style={{ color: "#9f1239", fontSize: 14 }}>
                              <AlertCircle className="mr-2 h-4 w-4" style={{ display: "inline", verticalAlign: "text-bottom" }} />
                              {state.detailsError}
                              <div style={{ marginTop: 6 }}>
                                <Button variant="outline" onClick={() => loadJobDetails(job)}>Retry</Button>
                              </div>
                              {state.rawPreview && (
                                <details style={{ marginTop: 8 }}>
                                  <summary style={{ cursor: "pointer", color: "#475569", fontSize: 12 }}>Show raw response (for debugging)</summary>
                                  <pre style={{ marginTop: 6, background: "#0f172a", color: "#e2e8f0", padding: 10, borderRadius: 8, fontSize: 11, overflow: "auto", maxHeight: 240 }}>
{state.rawPreview}
                                  </pre>
                                </details>
                              )}
                            </li>
                          )}

                          {state.import && !state.detailsError && (
                            <li style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                                  <div>
                                    <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Import ID</div>
                                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 600 }}>{state.import.import_id}</div>
                                  </div>
                                  <Button variant="secondary" onClick={() => downloadCsv(job)} disabled={state.downloading}>
                                    {state.downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                    Download CSV
                                  </Button>
                                </div>
                                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8 }}>
                                  <li style={{ background: "#f8fafc", borderRadius: 8, padding: 8, textAlign: "center" }}>
                                    <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>Total</div>
                                    <div style={{ fontSize: 18, fontWeight: 600 }}>{state.import.total_records}</div>
                                  </li>
                                  <li style={{ background: "#ecfdf5", borderRadius: 8, padding: 8, textAlign: "center" }}>
                                    <div style={{ fontSize: 11, color: "#065f46", textTransform: "uppercase" }}>Success</div>
                                    <div style={{ fontSize: 18, fontWeight: 600, color: "#047857" }}>{state.import.success_count}</div>
                                  </li>
                                  <li style={{ background: "#fffbeb", borderRadius: 8, padding: 8, textAlign: "center" }}>
                                    <div style={{ fontSize: 11, color: "#92400e", textTransform: "uppercase" }}>Warnings</div>
                                    <div style={{ fontSize: 18, fontWeight: 600, color: "#b45309" }}>{state.import.warning_count}</div>
                                  </li>
                                  <li style={{ background: "#fff1f2", borderRadius: 8, padding: 8, textAlign: "center" }}>
                                    <div style={{ fontSize: 11, color: "#9f1239", textTransform: "uppercase" }}>Errors</div>
                                    <div style={{ fontSize: 18, fontWeight: 600, color: "#be123c" }}>{state.import.error_count}</div>
                                  </li>
                                </ul>
                                {state.downloadError && (
                                  <div style={{ color: "#9f1239", fontSize: 13 }}>
                                    <AlertCircle className="mr-2 h-4 w-4" style={{ display: "inline", verticalAlign: "text-bottom" }} />
                                    {state.downloadError}
                                  </div>
                                )}
                              </div>
                            </li>
                          )}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Log */}
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">API Response Log</h2>
              <Badge>{logs.length} event(s)</Badge>
            </div>
            <div className="max-h-96 space-y-2 overflow-y-auto rounded-2xl bg-slate-950 p-4 font-mono text-xs text-slate-100">
              {logs.length === 0 ? (
                <div className="text-slate-400">No log events yet.</div>
              ) : (
                logs.map((log, index) => (
                  <div key={`${log.ts}-${index}`} className="flex gap-2 rounded-xl" style={{ background: "rgba(255,255,255,0.05)", padding: 8 }}>
                    {log.level === "success" ? (
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-400" />
                    ) : log.level === "error" ? (
                      <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-rose-400" />
                    ) : (
                      <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-amber-300" />
                    )}
                    <div>
                      <div>
                        <span className="text-slate-400">{log.ts}</span>{" "}
                        <span className="text-cyan-300">[{log.step}]</span> {log.message}
                      </div>
                      {(log.status || log.statusText || log.import_id) && (
                        <div className="mt-1 text-slate-400">
                          {log.status ? `status=${log.status} ${log.statusText || ""}` : ""}
                          {log.import_id ? ` import_id=${log.import_id}` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
