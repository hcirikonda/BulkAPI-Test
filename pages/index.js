import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Download, Loader2, Play } from "lucide-react";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const Card = ({ className = "", ...props }) => (
  <div className={className} style={{ border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }} {...props} />
);
const CardContent = ({ className = "", ...props }) => (
  <div className={className} style={{ padding: 16 }} {...props} />
);
const Button = ({ className = "", ...props }) => (
  <button className={className} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#0f172a", color: "#fff", cursor: "pointer" }} {...props} />
);
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

// Base URL construction per user's spec
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
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i += 1) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType || "text/csv" });
}

async function callProxy({ baseUrl, path, bearerToken, query, expectBlob }) {
  const res = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl, path, bearerToken, query, expectBlob: !!expectBlob }),
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
  // Portal Name defaults to EMPTY (per user's requirement)
  const [portalName, setPortalName] = useState("");
  const [environment, setEnvironment] = useState("pilot");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [pageNumber, setPageNumber] = useState(DEFAULTS.pageNumber);
  const [pageSize, setPageSize] = useState(DEFAULTS.pageSize);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState({ total_jobs_processed: 0, total_reports_generated: 0, total_failures: 0 });

  const computedBaseUrl = useMemo(() => buildBaseUrl(portalName, environment), [portalName, environment]);

  const addLog = (level, step, message, meta = {}) => {
    setLogs((current) => [{ ts: new Date().toISOString(), level, step, message, ...meta }, ...current]);
  };

  async function runWorkflow() {
    setRunning(true); setLogs([]); setResults([]);
    setSummary({ total_jobs_processed: 0, total_reports_generated: 0, total_failures: 0 });
    try {
      if (!portalName.trim()) { addLog("error", "Validation", "Portal Name is required."); return; }
      if (!fromDate || !toDate) { addLog("error", "Validation", "Both from and to dates are required."); return; }
      if (!bearerToken.trim()) { addLog("error", "Validation", "Bearer token is required."); return; }
      if (!computedBaseUrl) { addLog("error", "Validation", "Unable to construct base URL. Check portal name and environment."); return; }

      addLog("info", "Setup", `Portal=${portalName}, Environment=${environment}, Base URL=${computedBaseUrl}`);
      addLog("info", "Setup", `page_number=${pageNumber}, page_size=${pageSize}`);

      // Step 1: Retrieve Jobs
      let step1;
      try {
        step1 = await callProxy({
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
      } catch (error) {
        addLog("error", "Step 1", `Failed to retrieve jobs: ${error.message}`, { status: error.status });
        return;
      }
      addLog("success", "Step 1", `Retrieved jobs (page ${pageNumber}, size ${pageSize})`, { status: step1.status, statusText: step1.statusText });

      const jobs = normalizeJobsResponse(step1.body)
        .map((j) => ({ raw: j, job_id: extractJobId(j) }))
        .filter((j) => j.job_id);

      if (jobs.length === 0) {
        addLog("success", "Step 1", "No jobs found for the selected date range. Exiting gracefully.");
        return;
      }

      let reportsGenerated = 0;
      let failures = 0;
      const output = [];

      for (const job of jobs) {
        await sleep(1000);
        const row = {
          portal_name: portalName,
          environment,
          base_url: computedBaseUrl,
          page_number: pageNumber,
          page_size: pageSize,
          job_id: job.job_id,
          import_id: "",
          label: "",
          total_records: 0,
          success_count: 0,
          error_count: 0,
          warning_count: 0,
          report_status: "pending",
          report_filename: "",
          report_url: "",
          error_message: "",
        };

        // Step 2: Fetch Job Details
        try {
          const step2 = await callProxy({
            baseUrl: computedBaseUrl,
            path: `/services/api/x/bulk-api/v1/jobs/${encodeURIComponent(job.job_id)}`,
            bearerToken,
            query: {},
            expectBlob: false,
          });
          const metrics = extractExecutionSummary(step2.body);
          row.import_id = metrics.import_id || "";
          row.label = metrics.label || "";
          row.total_records = metrics.total_records;
          row.success_count = metrics.success_count;
          row.error_count = metrics.error_count;
          row.warning_count = metrics.warning_count;
          addLog("success", "Step 2", `Fetched details for job_id ${job.job_id}`, { status: step2.status, import_id: row.import_id });

          if (!row.import_id) throw new Error("No import_id in job details response.");
        } catch (error) {
          failures += 1;
          row.report_status = "failed";
          row.error_message = `Step 2: ${error.message}`;
          addLog("error", "Step 2", `Failed for job_id ${job.job_id}: ${error.message}`, { status: error.status });
          output.push(row);
          setResults([...output]);
          setSummary({ total_jobs_processed: output.length, total_reports_generated: reportsGenerated, total_failures: failures });
          continue;
        }

        // Step 3: Generate Import Report (CSV)
        try {
          const step3 = await callProxy({
            baseUrl: computedBaseUrl,
            path: `/services/api/x/bulk-api/v1/imports/${encodeURIComponent(row.import_id)}/report`,
            bearerToken,
            query: {},
            expectBlob: true,
          });
          const blob = base64ToBlob(step3.base64, step3.contentType || "text/csv");
          row.report_status = "success";
          row.report_filename = `bulk_import_report_job_${fileNameSafe(job.job_id)}_import_${fileNameSafe(row.import_id)}.csv`;
          row.report_url = URL.createObjectURL(blob);
          reportsGenerated += 1;
          addLog("success", "Step 3", `Generated CSV for import_id ${row.import_id}`, { status: step3.status });
        } catch (error) {
          failures += 1;
          row.report_status = "failed";
          row.error_message = `Step 3: ${error.message}`;
          addLog("error", "Step 3", `Failed for import_id ${row.import_id}: ${error.message}`, { status: error.status });
        }

        output.push(row);
        setResults([...output]);
        setSummary({ total_jobs_processed: output.length, total_reports_generated: reportsGenerated, total_failures: failures });
      }

      addLog("success", "Final", `Workflow complete. Processed ${output.length} job(s), generated ${reportsGenerated} report(s), failed ${failures}.`);
    } finally {
      setRunning(false);
    }
  }

  function exportSummaryJson() {
    const payload = {
      dynamicInputs: { portalName, environment, baseUrl: computedBaseUrl, pageNumber, pageSize },
      summary,
      results,
      logs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cornerstone_bulk_api_workflow_result.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Cornerstone Bulk API Workflow Engine</h1>
            <p className="mt-2 text-sm text-slate-600">Runs the 3-step Cornerstone Bulk API workflow via a serverless proxy — no browser CORS.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={runWorkflow} disabled={running}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run Workflow
            </Button>
          </div>
        </motion.div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="rounded-2xl shadow-sm lg:col-span-2">
            <CardContent className="grid gap-4 p-5 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Portal Name</Label>
                <Input value={portalName} onChange={(e) => setPortalName(e.target.value)} placeholder="e.g. tram, jaybro" disabled={running} />
              </div>
              <div className="space-y-2">
                <Label>Environment</Label>
                <select value={environment} onChange={(e) => setEnvironment(e.target.value)} disabled={running} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>
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
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={running} />
              </div>
              <div className="space-y-2">
                <Label>Job Create To Date</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={running} />
              </div>
              <div className="space-y-2">
                <Label>Page Number</Label>
                <Input type="number" min="1" value={pageNumber} onChange={(e) => setPageNumber(e.target.value)} disabled={running} />
              </div>
              <div className="space-y-2">
                <Label>Page Size</Label>
                <Input type="number" min="1" max="100" value={pageSize} onChange={(e) => setPageSize(e.target.value)} disabled={running} />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label>Bearer Token</Label>
                <Input type="password" placeholder="Paste OAuth access token" value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} disabled={running} />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardContent className="space-y-4 p-5">
              <h2 className="text-lg font-semibold">Final Summary</h2>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white p-3 text-center shadow-sm">
                  <div className="text-2xl font-semibold">{summary.total_jobs_processed}</div>
                  <div className="text-xs text-slate-500">Processed</div>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-3 text-center shadow-sm">
                  <div className="text-2xl font-semibold text-emerald-700">{summary.total_reports_generated}</div>
                  <div className="text-xs text-emerald-700">Reports</div>
                </div>
                <div className="rounded-2xl bg-rose-50 p-3 text-center shadow-sm">
                  <div className="text-2xl font-semibold text-rose-700">{summary.total_failures}</div>
                  <div className="text-xs text-rose-700">Failures</div>
                </div>
              </div>
              <Button className="w-full" onClick={exportSummaryJson} disabled={!results.length && !logs.length}>
                <Download className="mr-2 h-4 w-4" /> Export Run JSON
              </Button>
              <p className="text-xs text-slate-500">All API calls are routed through `/api/proxy`, so the browser never contacts Cornerstone directly.</p>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Structured Result Per Job</h2>
              <Badge>{results.length} row(s)</Badge>
            </div>
            <div className="overflow-x-auto rounded-2xl border bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Job ID</th>
                    <th className="p-3">Import ID</th>
                    <th className="p-3">Label</th>
                    <th className="p-3">Total</th>
                    <th className="p-3">Success</th>
                    <th className="p-3">Error</th>
                    <th className="p-3">Warning</th>
                    <th className="p-3">Report Status</th>
                    <th className="p-3">Report File</th>
                    <th className="p-3">Error Message</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 ? (
                    <tr><td className="p-4 text-slate-500" colSpan="10">No results yet. Run the workflow to populate this table.</td></tr>
                  ) : results.map((row) => (
                    <tr key={`${row.job_id}-${row.import_id || row.report_status}`} className="border-t">
                      <td className="p-3 font-medium">{row.job_id}</td>
                      <td className="p-3">{row.import_id}</td>
                      <td className="p-3">{row.label}</td>
                      <td className="p-3">{row.total_records}</td>
                      <td className="p-3 text-emerald-700">{row.success_count}</td>
                      <td className="p-3 text-rose-700">{row.error_count}</td>
                      <td className="p-3 text-amber-700">{row.warning_count}</td>
                      <td className="p-3">
                        <Badge className={row.report_status === "success" ? "bg-emerald-600" : row.report_status === "failed" ? "bg-rose-600" : "bg-slate-500"}>{row.report_status}</Badge>
                      </td>
                      <td className="p-3">
                        {row.report_url ? <a className="text-blue-600 underline" href={row.report_url} download={row.report_filename}>{row.report_filename}</a> : "-"}
                      </td>
                      <td className="p-3 text-rose-700">{row.error_message || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

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
                    {(log.status || log.statusText) && <div className="mt-1 text-slate-400">status={log.status || ""} {log.statusText || ""}</div>}
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
