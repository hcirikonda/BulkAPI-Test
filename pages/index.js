
import React, { useMemo, useRef, useState } from "react";
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

/* -------------------- inline UI primitives -------------------- */
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
const RETENTION_DAYS = 30;

function daysSince(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return null;
  const then = Date.UTC(y, m - 1, d);
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

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
function extractJobLabel(job) { return job?.label ?? job?.job_label ?? job?.name ?? job?.title ?? ""; }
function extractJobCreated(job) {
  const v = job?.job_create_date ?? job?.jobCreateDate ?? job?.created_at ?? job?.createdAt ?? job?.created ?? job?.date_created ?? null;
  if (!v) return null;
  // Return YYYY-MM-DD regardless of timezone/time component
  return String(v).slice(0, 10);
}

/**
 * Deep-walks any object/array and returns the first non-empty value for ANY of the given keys.
 * Case-insensitive. Kept as a fallback for unexpected response shapes.
 */
function deepFind(obj, keys, seen = new Set()) {
  if (obj == null || typeof obj !== "object" || seen.has(obj)) return undefined;
  seen.add(obj);
  const wanted = keys.map((k) => k.toLowerCase());
  for (const k of Object.keys(obj)) {
    if (wanted.includes(k.toLowerCase())) {
      const v = obj[k];
      if (v != null && v !== "") return v;
    }
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

// Your API returns: { imports: [{ id, total_records, successful_records, successful_records_with_warnings, error_records }], label }
function extractImportId(details) {
  const imp = Array.isArray(details?.imports) && details.imports.length ? details.imports[0] : null;
  if (imp?.id) return imp.id;
  return deepFind(details, ["import_id", "importId", "importID"]) ?? null;
}

function extractExecutionSummary(details) {
  const imp = Array.isArray(details?.imports) && details.imports.length ? details.imports[0] : (details || {});
  return {
    import_id: extractImportId(details),
    total_records: Number(imp.total_records ?? imp.totalRecords ?? imp.total ?? 0),
    success_count: Number(imp.successful_records ?? imp.success_count ?? imp.successCount ?? 0),
    warning_count: Number(imp.successful_records_with_warnings ?? imp.warning_count ?? imp.warningCount ?? 0),
    error_count: Number(imp.error_records ?? imp.error_count ?? imp.errorCount ?? 0),
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
  const [portalName, setPortalName] = useState("");
  const [environment, setEnvironment] = useState("pilot");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [pageNumber, setPageNumber] = useState(DEFAULTS.pageNumber);
  const [pageSize, setPageSize] = useState(DEFAULTS.pageSize);
  const [throttleMs, setThrottleMs] = useState(DEFAULTS.throttleMs);

  const [jobs, setJobs] = useState([]);
  const [phase1Meta, setPhase1Meta] = useState(null);
  const [phase1Running, setPhase1Running] = useState(false);
  const [jobState, setJobState] = useState({});

  const lastCallAtRef = useRef(0);

  const [logs, setLogs] = useState([]);
  const addLog = (level, step, message, meta = {}) => {
    setLogs((current) => [{ ts: new Date().toISOString(), level, step, message, ...meta }, ...current]);
  };

  const computedBaseUrl = useMemo(() => buildBaseUrl(portalName, environment), [portalName, environment]);
  const phase1Ready = portalName.trim() && fromDate && toDate && bearerToken.trim() && computedBaseUrl;

  // Show a soft warning right in the input area when the from-date is beyond retention
  const fromDateAge = useMemo(() => daysSince(fromDate), [fromDate]);
  const showRetentionBanner = fromDateAge != null && fromDateAge > RETENTION_DAYS;

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

      const fromAge = daysSince(fromDate);
      if (fromAge != null && fromAge > RETENTION_DAYS) {
        addLog(
          "warning",
          "Retention",
          `From date is ${fromAge} days old. Cornerstone Bulk API only retains CSV reports for ${RETENTION_DAYS} days — jobs older than that will list correctly but CSV download will fail with a "report expired" message.`
        );
      }

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
        .map((j) => ({
          job_id: extractJobId(j),
          label: extractJobLabel(j),
          created: extractJobCreated(j),
        }))
        .filter((j) => j.job_id);

      setPhase1Meta({ page_number: pageNumber, page_size: pageSize });

      if (list.length === 0) {
        addLog("info", "Step 1", "No jobs found for the selected date range.");
        return;
      }

      setJobs(list);
      addLog("success", "Step 1", `Retrieved ${list.length} job(s). Click a job_id to lazy-load its import details.`, {
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

  async function loadJobDetails(job) {
    const jobId = job.job_id;
    const current = jobState[jobId] || {};
    if (current.loadingDetails || current.import) return;
    updateJobState(jobId, { loadingDetails: true, detailsError: "", rawPreview: "" });

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
          detailsError: "No import_id could be resolved from the response. Raw response shown below.",
          rawPreview: preview,
        });
        addLog("warning", "Step 2", `import_id missing for job_id ${jobId}. Raw preview shown inline.`);
        return;
      }

      updateJobState(jobId, {
        loadingDetails: false,
        detailsError: "",
        rawPreview: "",
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

  async function toggleJob(job) {
    const jobId = job.job_id;
    const current = jobState[jobId] || {};
    const nextOpen = !current.open;
    updateJobState(jobId, { open: nextOpen });
    if (nextOpen && !current.import && !current.loadingDetails) {
      await loadJobDetails(job);
    }
  }

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
      let msg;
      const bodyStr = error.body ? (typeof error.body === "string" ? error.body : JSON.stringify(error.body)) : "";
      if (error.status === 429) {
        msg = "429 Too Many Requests — increase the throttle delay.";
      } else if (error.status === 404 || /not\s*found|expired|no\s*report/i.test(bodyStr)) {
        msg = `Report not available. Cornerstone Bulk API only retains CSV reports for ${RETENTION_DAYS} days — this job is older than that, so the report no longer exists on the server.`;
      } else {
        msg = error.message;
        if (bodyStr) msg += ` — upstream: ${bodyStr.slice(0, 400)}`;
      }
      updateJobState(jobId, { downloading: false, downloadError: msg });
      addLog("error", "Step 3", `CSV download failed: ${msg}`, { status: error.status });
    }
  }

  /* -------------------- render -------------------- */
  const th = { padding: "10px 12px", textAlign: "left", fontSize: 11, textTransform: "uppercase", color: "#64748b", letterSpacing: 0.5, background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
  const td = { padding: "12px", borderBottom: "1px solid #e2e8f0", fontSize: 14, verticalAlign: "middle" };

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-semibold tracking-tight">Cornerstone Bulk API — Lazy, Rate-Safe Workflow</h1>
          <p className="mt-2 text-sm text-slate-600">
            Collapsed rows show only Job ID and Label. Click a row to lazy-load its full import details into a structured table. A throttle gate prevents 429s. Reports older than {RETENTION_DAYS} days are not retained by Cornerstone.
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

            {showRetentionBanner && (
              <div className="lg:col-span-3" style={{ background: "#fef3c7", color: "#92400e", padding: 12, borderRadius: 10, border: "1px solid #fde68a", fontSize: 13, display: "flex", alignItems: "flex-start", gap: 8 }}>
                <AlertCircle className="h-4 w-4 shrink-0" style={{ marginTop: 2 }} />
                <div>
                  <strong>Heads up:</strong> Your From Date is {fromDateAge} days old. Cornerstone Bulk API only retains CSV reports for {RETENTION_DAYS} days. Jobs older than that will still list, but CSV downloads will fail with a "report expired" message.
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Structured job table */}
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Jobs</h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {phase1Meta && <Badge tone="blue">page {phase1Meta.page_number} / size {phase1Meta.page_size}</Badge>}
                <Badge>{jobs.length} job(s)</Badge>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <Button onClick={fetchJobsStep1} disabled={!phase1Ready || phase1Running}>
                {phase1Running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Fetch Jobs
              </Button>
              <span style={{ fontSize: 12, color: "#64748b" }}>
                Click a row to load import details. Throttle delay separates calls to avoid 429.
              </span>
            </div>

            {jobs.length > 0 && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th style={{ ...th, width: 32 }}></th>
                        <th style={th}>Job ID</th>
                        <th style={th}>Label</th>
                        <th style={th}>Import ID</th>
                        <th style={th}>Total Records</th>
                        <th style={th}>Success</th>
                        <th style={th}>Warnings</th>
                        <th style={th}>Errors</th>
                        <th style={th}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((job) => {
                        const state = jobState[job.job_id] || {};
                        const isOpen = !!state.open;
                        const imp = state.import;
                        const age = daysSince(job.created);
                        const stale = age != null && age > RETENTION_DAYS;

                        return (
                          <React.Fragment key={job.job_id}>
                            <tr
                              onClick={() => toggleJob(job)}
                              style={{ cursor: "pointer", background: isOpen ? "#f8fafc" : "#fff" }}
                            >
                              <td style={{ ...td, textAlign: "center" }}>
                                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </td>
                              <td style={{ ...td, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 600 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <span>{job.job_id}</span>
                                  {age != null && (
                                    <span title={job.created ? `Created ${job.created}` : ""}>
                                      <Badge tone={stale ? "amber" : "slate"}>
                                        {stale ? `Report expired (${age}d old)` : `${age}d old`}
                                      </Badge>
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td style={td}>{job.label || <span style={{ color: "#94a3b8" }}>—</span>}</td>

                              <td style={{ ...td, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                                {isOpen && state.loadingDetails && <Loader2 className="h-4 w-4 animate-spin" />}
                                {isOpen && imp && imp.import_id}
                                {(!isOpen || (!state.loadingDetails && !imp)) && <span style={{ color: "#94a3b8" }}>—</span>}
                              </td>

                              <td style={td}>
                                {isOpen && imp ? imp.total_records : <span style={{ color: "#94a3b8" }}>—</span>}
                              </td>

                              <td style={{ ...td, color: isOpen && imp ? "#047857" : "#94a3b8", fontWeight: isOpen && imp ? 600 : 400 }}>
                                {isOpen && imp ? imp.success_count : "—"}
                              </td>

                              <td style={{ ...td, color: isOpen && imp ? "#b45309" : "#94a3b8", fontWeight: isOpen && imp ? 600 : 400 }}>
                                {isOpen && imp ? imp.warning_count : "—"}
                              </td>

                              <td style={{ ...td, color: isOpen && imp ? "#be123c" : "#94a3b8", fontWeight: isOpen && imp ? 600 : 400 }}>
                                {isOpen && imp ? imp.error_count : "—"}
                              </td>

                              <td style={td} onClick={(e) => e.stopPropagation()}>
                                {isOpen && imp ? (
                                  <Button
                                    variant={stale ? "outline" : "secondary"}
                                    onClick={() => downloadCsv(job)}
                                    disabled={state.downloading}
                                    title={stale ? "Report likely expired (30-day retention). Click to try anyway." : "Download CSV report"}
                                  >
                                    {state.downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                    {stale ? "CSV (expired?)" : "CSV"}
                                  </Button>
                                ) : (
                                  <span style={{ color: "#94a3b8" }}>—</span>
                                )}
                              </td>
                            </tr>

                            {isOpen && (state.detailsError || state.downloadError) && (
                              <tr>
                                <td style={{ ...td, borderBottom: "1px solid #e2e8f0" }}></td>
                                <td colSpan={8} style={{ ...td, borderBottom: "1px solid #e2e8f0", background: "#fff1f2", color: "#9f1239" }}>
                                  <AlertCircle className="mr-2 h-4 w-4" style={{ display: "inline", verticalAlign: "text-bottom" }} />
                                  {state.detailsError || state.downloadError}
                                  {state.detailsError && (
                                    <div style={{ marginTop: 8 }}>
                                      <Button variant="outline" onClick={() => loadJobDetails(job)}>Retry</Button>
                                    </div>
                                  )}
                                  {state.rawPreview && (
                                    <details style={{ marginTop: 8 }}>
                                      <summary style={{ cursor: "pointer", color: "#475569", fontSize: 12 }}>Show raw response</summary>
                                      <pre style={{ marginTop: 6, background: "#0f172a", color: "#e2e8f0", padding: 10, borderRadius: 8, fontSize: 11, overflow: "auto", maxHeight: 240 }}>
{state.rawPreview}
                                      </pre>
                                    </details>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* API log */}
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">API Response Log</h2>
              <Badge>{logs.length} event(s)</Badge>
            </div>
            <div style={{ maxHeight: 384, overflowY: "auto", borderRadius: 12, background: "#020617", padding: 16, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, color: "#f1f5f9", display: "flex", flexDirection: "column", gap: 8 }}>
              {logs.length === 0 ? (
                <div style={{ color: "#94a3b8" }}>No log events yet.</div>
              ) : (
                logs.map((log, index) => (
                  <div key={`${log.ts}-${index}`} style={{ display: "flex", gap: 8, background: "rgba(255,255,255,0.05)", padding: 8, borderRadius: 10 }}>
                    {log.level === "success" ? (
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0" style={{ color: "#34d399" }} />
                    ) : log.level === "error" ? (
                      <AlertCircle className="mt-1 h-4 w-4 shrink-0" style={{ color: "#fb7185" }} />
                    ) : (
                      <AlertCircle className="mt-1 h-4 w-4 shrink-0" style={{ color: "#fcd34d" }} />
                    )}
                    <div>
                      <div>
                        <span style={{ color: "#94a3b8" }}>{log.ts}</span>{" "}
                        <span style={{ color: "#67e8f9" }}>[{log.step}]</span> {log.message}
                      </div>
                      {(log.status || log.statusText || log.import_id) && (
                        <div style={{ marginTop: 4, color: "#94a3b8" }}>
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
