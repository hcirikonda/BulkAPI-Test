import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Download, Loader2, Play, Search } from "lucide-react";

const Card = ({ className = "", ...props }) => (
  <div className={className} style={{ border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }} {...props} />
);
const CardContent = ({ className = "", ...props }) => (
  <div className={className} style={{ padding: 16 }} {...props} />
);
const Button = ({ className = "", variant = "primary", ...props }) => {
  const styles = {
    primary: { background: "#0f172a", color: "#fff" },
    secondary: { background: "#1d4ed8", color: "#fff" },
    outline: { background: "#fff", color: "#0f172a", border: "1px solid #cbd5e1" },
  };
  const s = styles[variant] || styles.primary;
  return (
    <button
      className={className}
      style={{ padding: "8px 16px", borderRadius: 8, border: s.border || "none", background: s.background, color: s.color, cursor: props.disabled ? "not-allowed" : "pointer", opacity: props.disabled ? 0.5 : 1, display: "inline-flex", alignItems: "center" }}
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
const Badge = ({ className = "", ...props }) => (
  <span className={className} style={{ padding: "2px 10px", borderRadius: 999, background: "#e2e8f0", fontSize: 12 }} {...props} />
);

const DEFAULTS = { pageNumber: 1, pageSize: 50 };

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
function extractImportId(details) { return details?.import_id ?? details?.importId ?? details?.data?.import_id ?? details?.data?.importId ?? null; }
function extractExecutionSummary(details) {
  const source = details?.data && typeof details.data === "object" ? details.data : details;
  return {
    import_id: extractImportId(details),
    label: source?.label ?? source?.job_label ?? source?.name ?? "",
    total_records: Number(source?.total_records ?? source?.totalRecords ?? source?.total ?? 0),
    success_count: Number(source?.success_count ?? source?.successCount ?? source?.success ?? 0),
    error_count: Number(source?.error_count ?? source?.errorCount ?? source?.errors ?? 0),
    warning_count: Number(source?.warning_count ?? source?.warningCount ?? source?.warnings ?? 0),
  };
}
function fileNameSafe(value) { return String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_"); }

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

export default function App() {
  // Portal Name MUST be empty by default
  const [portalName, setPortalName] = useState("");
  const [environment, setEnvironment] = useState("pilot");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [pageNumber, setPageNumber] = useState(DEFAULTS.pageNumber);
  const [pageSize, setPageSize] = useState(DEFAULTS.pageSize);

  // Phase 1 output
  const [jobIds, setJobIds] = useState([]);          // string[]
  const [phase1Meta, setPhase1Meta] = useState(null); // { page_number, page_size }

  // Phase 2 selection
  const [selectedJobId, setSelectedJobId] = useState("");

  // Phase 2/3 output
  const [phase23Result, setPhase23Result] = useState(null);

  // UX state
  const [phase1Running, setPhase1Running] = useState(false);
  const [phase23Running, setPhase23Running] = useState(false);
  const [logs, setLogs] = useState([]);

  const computedBaseUrl = useMemo(() => buildBaseUrl(portalName, environment), [portalName, environment]);

  const addLog = (level, step, message, meta = {}) => {
    setLogs((current) => [{ ts: new Date().toISOString(), level, step, message, ...meta }, ...current]);
  };

  // ✅ PHASE 1
  async function fetchJobsPhase1() {
    setPhase1Running(true);
    setJobIds([]);
    setSelectedJobId("");
    setPhase23Result(null);
    setPhase1Meta(null);
    try {
      if (!portalName.trim()) { addLog("error", "Validation", "Portal name is required."); return; }
      if (!fromDate || !toDate) { addLog("error", "Validation", "From and To dates are required."); return; }
      if (!bearerToken.trim()) { addLog("error", "Validation", "Bearer token is required."); return; }
      if (!computedBaseUrl) { addLog("error", "Validation", "Unable to construct base URL."); return; }

      addLog("info", "Phase 1", `Fetching jobs (page ${pageNumber}, size ${pageSize})…`);
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

      const ids = normalizeJobsResponse(payload.body).map(extractJobId).filter(Boolean).map(String);

      setPhase1Meta({ page_number: pageNumber, page_size: pageSize });

      if (ids.length === 0) {
        addLog("info", "Phase 1", "No jobs found for the selected date range.");
        return;
      }

      setJobIds(ids);
      addLog("success", "Phase 1", `Retrieved ${ids.length} job(s). Select one to proceed.`, {
        status: payload.status,
        statusText: payload.statusText,
      });
    } catch (error) {
      addLog("error", "Phase 1", `Failed to retrieve jobs: ${error.message}`, { status: error.status, statusText: error.statusText });
    } finally {
      setPhase1Running(false);
    }
  }

  // ✅ PHASE 2 + PHASE 3 (runs together for the ONE selected job)
  async function runPhase2And3() {
    if (!selectedJobId) {
      addLog("error", "Validation", "Please select a job ID before running Phase 2.");
      return;
    }
    setPhase23Running(true);
    setPhase23Result(null);

    const result = {
      selected_job_id: selectedJobId,
      import_id: "",
      label: "",
      execution_summary: {
        total_records: 0,
        success_count: 0,
        error_count: 0,
        warning_count: 0,
      },
      csv_report_status: "pending",
      report_filename: "",
      report_url: "",
      error_message: "",
    };

    try {
      // PHASE 2 — fetch job details
      addLog("info", "Phase 2", `Fetching details for selected_job_id ${selectedJobId}…`);
      const detail = await callProxy({
        baseUrl: computedBaseUrl,
        path: `/services/api/x/bulk-api/v1/jobs/${encodeURIComponent(selectedJobId)}`,
        bearerToken,
        query: {},
        expectBlob: false,
      });
      const metrics = extractExecutionSummary(detail.body);
      result.import_id = metrics.import_id || "";
      result.label = metrics.label || "";
      result.execution_summary = {
        total_records: metrics.total_records,
        success_count: metrics.success_count,
        error_count: metrics.error_count,
        warning_count: metrics.warning_count,
      };
      addLog("success", "Phase 2", `Fetched details for job_id ${selectedJobId}`, { import_id: result.import_id, status: detail.status });

      if (!result.import_id) {
        throw new Error("Invalid job_id — no import_id returned in job details.");
      }

      // PHASE 3 — generate CSV report (mandatory)
      addLog("info", "Phase 3", `Generating CSV report for import_id ${result.import_id}…`);
      const report = await callProxy({
        baseUrl: computedBaseUrl,
        path: `/services/api/x/bulk-api/v1/imports/${encodeURIComponent(result.import_id)}/report`,
        bearerToken,
        query: {},
        expectBlob: true,
      });
      const blob = base64ToBlob(report.base64, report.contentType || "text/csv");
      const objectUrl = URL.createObjectURL(blob);
      const filename = `bulk_import_report_job_${fileNameSafe(selectedJobId)}_import_${fileNameSafe(result.import_id)}.csv`;
      result.csv_report_status = "CSV generated";
      result.report_filename = filename;
      result.report_url = objectUrl;
      addLog("success", "Phase 3", `CSV report ready: ${filename}`, { status: report.status });

      setPhase23Result(result);

      // Auto-trigger download for CSV mandatory delivery
      try {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (_) { /* ignore */ }
    } catch (error) {
      result.csv_report_status = "failed";
      result.error_message = error.message;
      setPhase23Result(result);
      addLog("error", "Phase 2/3", `Failed for job_id ${selectedJobId}: ${error.message}`, { status: error.status });
    } finally {
      setPhase23Running(false);
    }
  }

  function exportRunJson() {
    const payload = {
      phase1_output: {
        portal_name: portalName,
        environment,
        base_url: computedBaseUrl,
        page_number: phase1Meta?.page_number ?? pageNumber,
        page_size: phase1Meta?.page_size ?? pageSize,
        job_ids: jobIds,
      },
      phase23_output: phase23Result || null,
      logs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cornerstone_bulk_api_phased_run.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const phase1Ready = portalName.trim() && fromDate && toDate && bearerToken.trim() && computedBaseUrl;

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-semibold tracking-tight">Cornerstone Bulk API — Phased Workflow</h1>
          <p className="mt-2 text-sm text-slate-600">
            Phase 1 lists jobs. You pick one. Phase 2 fetches its details. Phase 3 downloads the CSV report. Only one job is processed per execution.
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
                placeholder="Enter portal name (e.g. tram, jaybro)"
                disabled={phase1Running || phase23Running}
              />
            </div>
            <div className="space-y-2">
              <Label>Environment</Label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                disabled={phase1Running || phase23Running}
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
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={phase1Running || phase23Running} />
            </div>
            <div className="space-y-2">
              <Label>Job Create To Date</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={phase1Running || phase23Running} />
            </div>
            <div className="space-y-2">
              <Label>Page Number</Label>
              <Input type="number" min="1" value={pageNumber} onChange={(e) => setPageNumber(e.target.value)} disabled={phase1Running || phase23Running} />
            </div>
            <div className="space-y-2">
              <Label>Page Size</Label>
              <Input type="number" min="1" max="100" value={pageSize} onChange={(e) => setPageSize(e.target.value)} disabled={phase1Running || phase23Running} />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label>Bearer Token</Label>
              <Input type="password" placeholder="Paste OAuth access token" value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} disabled={phase1Running || phase23Running} autoComplete="off" />
            </div>
          </CardContent>
        </Card>

        {/* Phase 1 controls */}
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Phase 1 — Retrieve Jobs</h2>
              <Badge>{jobIds.length} job(s) fetched</Badge>
            </div>
            <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
              <Button onClick={fetchJobsPhase1} disabled={!phase1Ready || phase1Running || phase23Running}>
                {phase1Running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Fetch Jobs
              </Button>
              <Button variant="outline" onClick={exportRunJson} disabled={!logs.length && !jobIds.length && !phase23Result}>
                <Download className="mr-2 h-4 w-4" /> Export Run JSON
              </Button>
            </div>

            {/* Job selector — only shown after Phase 1 returns results */}
            {jobIds.length > 0 && (
              <div className="mt-4 space-y-2">
                <Label>Select Job ID (required for Phase 2)</Label>
                <select
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  disabled={phase23Running}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
                >
                  <option value="">— Choose a job_id —</option>
                  {jobIds.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>

                {/* Job IDs table for visibility */}
                <div className="mt-3 overflow-x-auto rounded-2xl border bg-white">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="p-3">#</th>
                        <th className="p-3">Job ID</th>
                        <th className="p-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobIds.map((id, idx) => (
                        <tr key={id} className="border-t">
                          <td className="p-3">{idx + 1}</td>
                          <td className="p-3 font-medium">{id}</td>
                          <td className="p-3">
                            <Button variant="outline" onClick={() => setSelectedJobId(id)} disabled={phase23Running}>
                              {selectedJobId === id ? "Selected" : "Select"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Phase 2 + 3 controls */}
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Phase 2 & 3 — Fetch Details + Generate CSV</h2>
              <Badge>{selectedJobId ? `Selected: ${selectedJobId}` : "No job selected"}</Badge>
            </div>
            <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
              <Button variant="secondary" onClick={runPhase2And3} disabled={!selectedJobId || phase23Running || phase1Running}>
                {phase23Running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Run Phase 2 & 3
              </Button>
            </div>

            {phase23Result && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div style={{ background: "#f8fafc", borderRadius: 12, padding: 16 }}>
                  <div className="text-xs uppercase text-slate-500">Selected Job</div>
                  <div className="text-lg font-semibold">{phase23Result.selected_job_id}</div>
                  <div className="mt-2 text-xs uppercase text-slate-500">Import ID</div>
                  <div className="text-sm font-medium">{phase23Result.import_id || "—"}</div>
                  <div className="mt-2 text-xs uppercase text-slate-500">Label</div>
                  <div className="text-sm">{phase23Result.label || "—"}</div>
                  <div className="mt-2 text-xs uppercase text-slate-500">CSV Report Status</div>
                  <div className="text-sm">
                    <Badge className={phase23Result.csv_report_status === "CSV generated" ? "bg-emerald-600" : phase23Result.csv_report_status === "failed" ? "bg-rose-600" : "bg-slate-500"}>
                      {phase23Result.csv_report_status}
                    </Badge>
                  </div>
                  {phase23Result.report_url && (
                    <div className="mt-3">
                      <a className="text-blue-600 underline" href={phase23Result.report_url} download={phase23Result.report_filename}>
                        Re-download {phase23Result.report_filename}
                      </a>
                    </div>
                  )}
                  {phase23Result.error_message && (
                    <div className="mt-2 text-sm text-rose-700">{phase23Result.error_message}</div>
                  )}
                </div>
                <div style={{ background: "#f8fafc", borderRadius: 12, padding: 16 }}>
                  <div className="text-xs uppercase text-slate-500 mb-2">Execution Summary</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white p-3 text-center shadow-sm">
                      <div className="text-2xl font-semibold">{phase23Result.execution_summary.total_records}</div>
                      <div className="text-xs text-slate-500">Total</div>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-3 text-center shadow-sm">
                      <div className="text-2xl font-semibold text-emerald-700">{phase23Result.execution_summary.success_count}</div>
                      <div className="text-xs text-emerald-700">Success</div>
                    </div>
                    <div className="rounded-2xl bg-rose-50 p-3 text-center shadow-sm">
                      <div className="text-2xl font-semibold text-rose-700">{phase23Result.execution_summary.error_count}</div>
                      <div className="text-xs text-rose-700">Errors</div>
                    </div>
                    <div className="rounded-2xl p-3 text-center shadow-sm" style={{ background: "#fffbeb" }}>
                      <div className="text-2xl font-semibold text-amber-700">{phase23Result.execution_summary.warning_count}</div>
                      <div className="text-xs text-amber-700">Warnings</div>
                    </div>
                  </div>
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
            <div className="max-h-96 space-y-2 overflow-y-auto rounded-2xl bg-slate-950 p-4 font-mono text-xs text-slate-100">
              {logs.length === 0 ? <div className="text-slate-400">No log events yet.</div> : logs.map((log, index) => (
                <div key={`${log.ts}-${index}`} className="flex gap-2 rounded-xl" style={{ background: "rgba(255,255,255,0.05)", padding: 8 }}>
                  {log.level === "success" ? <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-400" /> : log.level === "error" ? <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-rose-400" /> : <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-amber-300" />}
                  <div>
                    <div><span className="text-slate-400">{log.ts}</span> <span className="text-cyan-300">[{log.step}]</span> {log.message}</div>
                    {(log.status || log.statusText || log.import_id) && (
                      <div className="mt-1 text-slate-400">
                        {log.status ? `status=${log.status} ${log.statusText || ""}` : ""}{log.import_id ? ` import_id=${log.import_id}` : ""}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
