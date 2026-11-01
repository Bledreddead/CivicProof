
"use client";

import { Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

type Investigation = {
  report?: any;
  analysis?: any;
  evidence?: any[];
  routing?: any;
  duplicates?: any;
  action_brief?: any;
};

type EvidenceFile = {
  id: string;
  report_id: string;
  file_type: string;
  description?: string;
  uploaded_at?: string;
  signed_url: string | null;
  url_expires_in_seconds?: number | null;
  url_error?: string | null;
};

type HistoryEntry = {
  id: string;
  previous_status: string | null;
  new_status: string;
  notes?: string | null;
  created_at: string;
  changed_by?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  submitted: "Reported",
  analysing: "AI Analysis",
  under_review: "Under Review",
  verified: "Verified",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved",
  rejected: "Rejected",
};

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  submitted: ["analysing", "under_review", "rejected"],
  analysing: ["under_review", "verified", "rejected"],
  under_review: ["verified", "assigned", "rejected"],
  verified: ["assigned", "under_review"],
  assigned: ["in_progress", "under_review"],
  in_progress: ["resolved", "under_review"],
  resolved: ["under_review"],
  rejected: ["under_review"],
};

function safeText(value: any, fallback = "Not available"): string {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "object") {
    if (typeof value.name === "string") return value.name;
    if (typeof value.title === "string") return value.title;
    return JSON.stringify(value);
  }

  return fallback;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status.replaceAll("_", " ");
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#111a2b] p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  color = "text-white",
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function ListItems({ items }: { items: any }) {
  if (!Array.isArray(items) || items.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No information available.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item: any, index: number) => (
        <li
          key={index}
          className="flex gap-2 text-sm leading-6 text-slate-300"
        >
          <span className="text-blue-400">•</span>
          <span>{safeText(item)}</span>
        </li>
      ))}
    </ul>
  );
}

function InvestigationContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const reportId = params.id;

  const [data, setData] = useState<Investigation | null>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [evidenceError, setEvidenceError] = useState("");
  const [historyError, setHistoryError] = useState("");

  // Status management
  const [selectedStatus, setSelectedStatus] = useState("");
  const [statusNotes, setStatusNotes] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [statusSuccess, setStatusSuccess] = useState("");

  async function loadHistory() {
    try {
      setHistoryError("");

      const response = await fetch(
        `${API_URL}/reports/${reportId}/history`,
        { headers: { Authorization: `Bearer ${session?.access_token}` } }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not load activity history.");
      }

      setHistory(
        Array.isArray(result.history) ? result.history : []
      );
    } catch (err: any) {
      setHistoryError(
        err.message || "Could not retrieve activity history."
      );
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInvestigation() {
      try {
        setLoading(true);
        setError("");
        setEvidenceError("");
        setEvidenceFiles([]);
        setFailedImages([]);

        const response = await fetch(
          `${API_URL}/reports/${reportId}/investigation`,
          { headers: { Authorization: `Bearer ${session?.access_token}` } }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.detail || "Could not load investigation."
          );
        }

        if (cancelled) return;

        setData(result);
        setSelectedStatus(result.report?.status || "submitted");

        // Fetch secure evidence URLs.
        try {
          const evidenceResponse = await fetch(
            `${API_URL}/reports/${reportId}/evidence`,
            { headers: { Authorization: `Bearer ${session?.access_token}` } }
          );

          const evidenceResult = await evidenceResponse.json();

          if (!evidenceResponse.ok) {
            throw new Error(
              evidenceResult.detail ||
                "Could not retrieve evidence photographs."
            );
          }

          if (!cancelled) {
            setEvidenceFiles(
              Array.isArray(evidenceResult.evidence)
                ? evidenceResult.evidence
                : []
            );
          }
        } catch (evidenceFetchError: any) {
          if (!cancelled) {
            setEvidenceError(
              evidenceFetchError.message ||
                "Evidence photographs could not be loaded."
            );
          }
        }

        // Fetch status history independently.
        try {
          const historyResponse = await fetch(
            `${API_URL}/reports/${reportId}/history`
          );

          const historyResult = await historyResponse.json();

          if (!historyResponse.ok) {
            throw new Error(
              historyResult.detail || "Could not load activity history."
            );
          }

          if (!cancelled) {
            setHistory(
              Array.isArray(historyResult.history)
                ? historyResult.history
                : []
            );
            setHistoryError("");
          }
        } catch (historyFetchError: any) {
          if (!cancelled) {
            setHistoryError(
              historyFetchError.message ||
                "Could not retrieve activity history."
            );
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Something went wrong.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (authLoading) return;
    if (!session?.access_token) {
      router.replace("/login");
      return;
    }
    if (reportId) {
      loadInvestigation();
    }

    return () => {
      cancelled = true;
    };
  }, [reportId, session?.access_token, authLoading, router]);

  async function updateStatus() {
    if (!selectedStatus) {
      setStatusError("Select a new status first.");
      return;
    }

    setSavingStatus(true);
    setStatusError("");
    setStatusSuccess("");

    try {
      const response = await fetch(
        `${API_URL}/reports/${reportId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            status: selectedStatus,
            notes: statusNotes.trim() || null,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail || "Unable to update incident status."
        );
      }

      // Update the displayed report immediately.
      setData((previous) => {
        if (!previous) return previous;

        return {
          ...previous,
          report: {
            ...previous.report,
            status: selectedStatus,
          },
        };
      });

      setStatusSuccess(
        `Status successfully changed to ${statusLabel(selectedStatus)}.`
      );

      setStatusNotes("");

      // Reload the timeline from the backend.
      await loadHistory();
    } catch (err: any) {
      setStatusError(
        err.message || "Something went wrong while updating status."
      );
    } finally {
      setSavingStatus(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080e1a] text-slate-300">
        Loading incident investigation...
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-[#080e1a] p-10 text-white">
        <button
          onClick={() => router.push("/")}
          className="mb-6 text-blue-400"
        >
          ← Back to dashboard
        </button>
        <p className="text-red-400">
          {error || "Investigation not found."}
        </p>
      </main>
    );
  }

  // Normalize backend response data.
  const report = data.report || {};
  const analysis = data.analysis || {};
  const rawRouting = data.routing?.routing || data.routing || {};
  const duplicates = data.duplicates || {};
  const brief = data.action_brief || {};
  const evidence = Array.isArray(data.evidence) ? data.evidence : [];

  const currentStatus = report.status || "submitted";

  const allowedNextStatuses =
    ALLOWED_TRANSITIONS[currentStatus] || [];

  const departmentObject =
    typeof rawRouting.department === "object" &&
    rawRouting.department !== null
      ? rawRouting.department
      : null;

  const departmentName = safeText(
    departmentObject?.name ?? rawRouting.department,
    "Department unavailable"
  );

  const jurisdiction = safeText(
    rawRouting.jurisdiction ?? departmentObject?.jurisdiction
  );

  const routingSource =
    rawRouting.source_url ?? departmentObject?.source_url;

  const routingCategory =
    rawRouting.category ?? analysis.category ?? report.category;

  const rawAnalysis = analysis.raw_analysis || {};

  const observations =
    analysis.observations ?? rawAnalysis.observations ?? [];

  const risks =
    analysis.risks ??
    analysis.potential_risks ??
    rawAnalysis.potential_risks ??
    [];

  const missingInformation =
    analysis.missing_information ??
    rawAnalysis.missing_information ??
    [];

  const limitations =
    analysis.limitations ?? rawAnalysis.limitations ?? [];

  const issueSummary =
    analysis.issue_summary ??
    rawAnalysis.issue_summary ??
    analysis.asset_type ??
    analysis.category;

  const priority = Number(report.priority_score ?? 0);
  const severity = analysis.severity ?? report.severity;
  const confidence = analysis.confidence;

  const candidates = Array.isArray(duplicates.candidates)
    ? duplicates.candidates
    : [];

  const imageFiles = evidenceFiles.filter((item) =>
    item.file_type?.startsWith("image/")
  );

  return (
    <main className="min-h-screen bg-[#080e1a] px-5 py-8 text-white md:px-10">
      <div className="mx-auto max-w-7xl">

        {/* Navigation */}
        <button
          onClick={() => router.push("/")}
          className="mb-8 text-sm text-blue-400 transition hover:text-blue-300"
        >
          ← Back to Command Centre
        </button>

        {/* Header */}
        <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
              CivicProof / Incident Investigation
            </p>

            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
              {safeText(report.title, "Untitled incident")}
            </h1>

            <p className="mt-3 break-all text-sm text-slate-400">
              Report ID: {safeText(report.id)}
            </p>

            <p className="mt-1 text-sm text-slate-400">
              {safeText(report.location_text, "Location not provided")}
            </p>
          </div>

          <span className="w-fit rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-xs font-medium uppercase text-blue-300">
            {statusLabel(currentStatus)}
          </span>
        </div>

        {/* Metrics */}
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric
            label="AI severity"
            value={severity != null ? `${severity}/5` : "Pending"}
          />

          <Metric
            label="Priority score"
            value={report.priority_score ?? "Pending"}
            color="text-blue-400"
          />

          <Metric
            label="AI confidence"
            value={
              typeof confidence === "number"
                ? `${(confidence * 100).toFixed(0)}%`
                : "Unavailable"
            }
          />

          <Metric
            label="Evidence files"
            value={evidence.length}
          />
        </div>

        {/* STATUS MANAGEMENT */}
        <div className="mb-8 grid gap-5 lg:grid-cols-[1fr_1.2fr]">

          <Panel title="Incident workflow management">
            <div className="space-y-5">

              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">
                  Current internal status
                </p>

                <p className="mt-2 text-2xl font-semibold text-blue-400">
                  {statusLabel(currentStatus)}
                </p>

                <p className="mt-2 text-xs leading-5 text-slate-500">
                  This status represents the incident's internal CivicProof
                  review workflow. It does not confirm action by a government
                  department.
                </p>
              </div>

              <div>
                <label
                  htmlFor="new-status"
                  className="mb-2 block text-sm text-slate-400"
                >
                  Change incident status
                </label>

                <select
                  id="new-status"
                  value={selectedStatus}
                  onChange={(event) => {
                    setSelectedStatus(event.target.value);
                    setStatusError("");
                    setStatusSuccess("");
                  }}
                  disabled={savingStatus || allowedNextStatuses.length === 0}
                  className="w-full rounded-lg border border-white/10 bg-[#080e1a] px-4 py-3 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  {allowedNextStatuses.length === 0 ? (
                    <option value="">
                      No further transitions available
                    </option>
                  ) : (
                    <>
                      <option value="">Select next status</option>
                      {allowedNextStatuses.map((status) => (
                        <option key={status} value={status}>
                          {statusLabel(status)}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              <div>
                <label
                  htmlFor="status-notes"
                  className="mb-2 block text-sm text-slate-400"
                >
                  Operator notes
                </label>

                <textarea
                  id="status-notes"
                  value={statusNotes}
                  onChange={(event) => setStatusNotes(event.target.value)}
                  placeholder="Explain why this status is being changed..."
                  maxLength={1000}
                  rows={4}
                  disabled={savingStatus}
                  className="w-full resize-y rounded-lg border border-white/10 bg-[#080e1a] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-blue-500 disabled:opacity-50"
                />

                <p className="mt-1 text-right text-xs text-slate-600">
                  {statusNotes.length}/1000
                </p>
              </div>

              {statusError && (
                <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">
                  {statusError}
                </div>
              )}

              {statusSuccess && (
                <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-300">
                  {statusSuccess}
                </div>
              )}

              <button
                onClick={updateStatus}
                disabled={
                  savingStatus ||
                  !selectedStatus ||
                  !allowedNextStatuses.includes(selectedStatus)
                }
                className="w-full rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingStatus ? "Updating status..." : "Update incident status"}
              </button>

              <p className="text-xs leading-5 text-slate-500">
                Every successful change is recorded in the incident history
                and audit log.
              </p>
            </div>
          </Panel>

          <Panel title="Incident activity timeline">
            {historyError ? (
              <div className="space-y-3">
                <p className="text-sm text-amber-300">{historyError}</p>
                <button
                  onClick={loadHistory}
                  className="text-sm text-blue-400 hover:underline"
                >
                  Retry loading history
                </button>
              </div>
            ) : history.length > 0 ? (
              <div className="relative space-y-0">
                {history.map((entry, index) => (
                  <div key={entry.id} className="relative flex gap-4 pb-6">
                    <div className="flex flex-col items-center">
                      <div className="z-10 mt-1 h-3 w-3 rounded-full border-2 border-blue-400 bg-[#111a2b]" />
                      {index !== history.length - 1 && (
                        <div className="absolute bottom-0 left-[5px] top-4 w-px bg-white/10" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">
                        {entry.previous_status
                          ? statusLabel(entry.previous_status)
                          : "Initial status"}{" "}
                        <span className="text-slate-500">→</span>{" "}
                        <span className="text-blue-400">
                          {statusLabel(entry.new_status)}
                        </span>
                      </p>

                      {entry.notes && (
                        <p className="mt-2 text-sm leading-6 text-slate-300">
                          {entry.notes}
                        </p>
                      )}

                      <p className="mt-2 text-xs text-slate-500">
                        {new Date(entry.created_at).toLocaleString()}
                      </p>

                      <p className="mt-1 text-xs text-slate-600">
                        {entry.changed_by
                          ? `Operator ID: ${entry.changed_by}`
                          : "Operator identity not recorded"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/10 p-6 text-center">
                <p className="text-sm text-slate-400">
                  No status changes recorded yet.
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  Future workflow updates will appear here automatically.
                </p>
              </div>
            )}

            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="text-xs leading-5 text-slate-500">
                Timeline entries are retrieved from the backend status history.
                Changes are not fabricated or generated by the frontend.
              </p>
            </div>
          </Panel>
        </div>

        {/* Main investigation grid */}
        <div className="grid gap-5 lg:grid-cols-2">

          {/* Incident information */}
          <Panel title="Incident information">
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-slate-500">Citizen description</p>
                <p className="mt-1 leading-6 text-slate-200">
                  {safeText(report.description, "No description provided.")}
                </p>
              </div>

              <div>
                <p className="text-slate-500">Reported category</p>
                <p className="mt-1 capitalize text-slate-200">
                  {safeText(report.category, "Unclassified")}
                </p>
              </div>

              <div>
                <p className="text-slate-500">Coordinates</p>
                <p className="mt-1 text-slate-200">
                  {report.latitude != null && report.longitude != null
                    ? `${report.latitude}, ${report.longitude}`
                    : "Coordinates unavailable"}
                </p>
              </div>

              <div>
                <p className="text-slate-500">Created at</p>
                <p className="mt-1 text-slate-200">
                  {report.created_at
                    ? new Date(report.created_at).toLocaleString()
                    : "Unavailable"}
                </p>
              </div>
            </div>
          </Panel>

          {/* AI analysis */}
          <Panel title="AI visual investigation">
            {analysis.id || analysis.category || rawAnalysis.category ? (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-slate-500">Detected issue</p>
                  <p className="mt-1 font-medium text-white">
                    {safeText(issueSummary, "Analysis completed")}
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-slate-500">
                    Visual observations
                  </p>
                  <ListItems items={observations} />
                </div>

                <div>
                  <p className="mb-2 text-slate-500">Potential risks</p>
                  <ListItems items={risks} />
                </div>

                {analysis.severity_reason && (
                  <div>
                    <p className="text-slate-500">Severity reasoning</p>
                    <p className="mt-1 text-slate-300">
                      {safeText(analysis.severity_reason)}
                    </p>
                  </div>
                )}

                <p className="text-xs text-slate-500">
                  Model: {safeText(analysis.model_name)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                AI analysis is not available for this report yet.
              </p>
            )}
          </Panel>

          {/* Priority */}
          <Panel title="Priority assessment">
            <div className="mb-5">
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-slate-400">
                  Calculated priority
                </span>
                <span className="font-semibold text-blue-400">
                  {report.priority_score ?? "Pending"}
                </span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, priority))}%`,
                  }}
                />
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Severity</span>
                <span>{severity != null ? `${severity}/5` : "Pending"}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Nearby reports</span>
                <span>{duplicates.nearby_count ?? 0}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Potential duplicates</span>
                <span>{duplicates.potential_duplicate_count ?? 0}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Human review required</span>
                <span className="text-amber-400">
                  {analysis.requires_human_review ? "Yes" : "Not flagged"}
                </span>
              </div>
            </div>

            <p className="mt-4 border-t border-white/10 pt-4 text-xs leading-relaxed text-slate-500">
              This is an internal, explainable triage score. It is not an
              official municipal priority or an assurance of government action.
            </p>
          </Panel>

          {/* Department routing */}
          <Panel title="Department recommendation">
            {departmentObject || rawRouting.department ? (
              <div className="space-y-3 text-sm">
                <p className="text-xl font-semibold text-white">
                  {departmentName}
                </p>

                <p className="text-slate-400">
                  Jurisdiction: {jurisdiction}
                </p>

                <p className="text-slate-400">
                  Detected category: {safeText(routingCategory)}
                </p>

                <p className="text-slate-400">
                  Verification:{" "}
                  <span className="text-amber-400">
                    {safeText(
                      rawRouting.verification_status ??
                        (rawRouting.rule_verified ? "Verified" : "Unverified"),
                      "Unverified"
                    )}
                  </span>
                </p>

                {routingSource && (
                  <a
                    href={routingSource}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-blue-400 hover:underline"
                  >
                    View routing source ↗
                  </a>
                )}

                <p className="border-t border-white/10 pt-3 text-xs leading-5 text-slate-500">
                  This is a candidate department recommendation, not an
                  official assignment or submitted complaint. Jurisdiction
                  and department mappings still require verification.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No department recommendation available.
              </p>
            )}
          </Panel>

          {/* Duplicate intelligence */}
          <Panel title="Duplicate intelligence">
            <p className="mb-4 text-sm text-slate-400">
              Nearby reports: {duplicates.nearby_count ?? 0}
              {" · "}
              Potential duplicates: {duplicates.potential_duplicate_count ?? 0}
            </p>

            {candidates.length > 0 ? (
              <div className="space-y-3">
                {candidates.map((item: any, index: number) => (
                  <div
                    key={item.id || index}
                    className="rounded-lg border border-white/10 p-3"
                  >
                    <p className="font-medium">
                      {safeText(item.title, "Untitled report")}
                    </p>

                    <p className="mt-1 text-xs text-slate-400">
                      {safeText(item.category)}
                      {" · "}
                      {item.distance_meters != null
                        ? `${Number(item.distance_meters).toFixed(0)} m away`
                        : "Distance unavailable"}
                    </p>

                    <p className="mt-1 text-xs text-amber-400">
                      {item.match_type === "potential_duplicate"
                        ? "Potential semantic match — requires human review"
                        : "Nearby report — not confirmed as a duplicate"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No nearby or semantically similar reports were returned.
              </p>
            )}
          </Panel>

          {/* Missing information */}
          <Panel title="Missing information & limitations">
            <div className="mb-5">
              <p className="mb-2 text-sm text-slate-400">
                Information needed for verification
              </p>
              <ListItems items={missingInformation} />
            </div>

            <div>
              <p className="mb-2 text-sm text-slate-400">
                AI analysis limitations
              </p>
              <ListItems items={limitations} />
            </div>
          </Panel>
        </div>

        {/* Citizen-uploaded evidence photographs */}
        <div className="mt-5">
          <Panel title="Citizen-submitted evidence photographs">
            {evidenceError ? (
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4">
                <p className="text-sm text-amber-300">
                  {evidenceError}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  The investigation data is available, but the secure
                  photograph links could not be retrieved.
                </p>
              </div>
            ) : imageFiles.length > 0 ? (
              <div className="grid gap-5 md:grid-cols-2">
                {imageFiles.map((item, index) => (
                  <div
                    key={item.id || index}
                    className="overflow-hidden rounded-xl border border-white/10 bg-[#080e1a]"
                  >
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <span className="text-sm font-medium text-slate-200">
                        Citizen evidence {index + 1}
                      </span>

                      <span className="text-xs text-slate-500">
                        {safeText(item.file_type)}
                      </span>
                    </div>

                    {item.signed_url && !failedImages.includes(item.id) ? (
                      <>
                        <div className="flex min-h-48 items-center justify-center bg-black/30 p-2">
                          <img
                            src={item.signed_url}
                            alt={`Citizen-submitted evidence ${index + 1}`}
                            className="max-h-[480px] w-full rounded-lg object-contain"
                            onError={() => {
                              setFailedImages((current) =>
                                current.includes(item.id)
                                  ? current
                                  : [...current, item.id]
                              );
                            }}
                          />
                        </div>

                        <div className="space-y-3 p-4">
                          <p className="text-sm leading-6 text-slate-300">
                            {safeText(
                              item.description,
                              "No upload description provided."
                            )}
                          </p>

                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs text-slate-500">
                              Uploaded:{" "}
                              {item.uploaded_at
                                ? new Date(item.uploaded_at).toLocaleString()
                                : "Unavailable"}
                            </span>

                            <a
                              href={item.signed_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
                            >
                              Open original image ↗
                            </a>
                          </div>

                          <p className="text-xs text-slate-600">
                            Secure temporary image link · Expires in 15 minutes
                          </p>
                        </div>
                      </>
                    ) : (
                      <div className="p-6">
                        <p className="text-sm text-amber-300">
                          {failedImages.includes(item.id)
                            ? "The image could not be loaded. Its temporary link may have expired."
                            : item.url_error || "Image URL unavailable."}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : evidence.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-amber-300">
                  Evidence records exist, but no displayable image URL was returned.
                </p>
                {evidence.map((item: any, index: number) => (
                  <div
                    key={item.id || index}
                    className="rounded-lg border border-white/10 p-3"
                  >
                    <p className="text-sm text-slate-200">
                      Evidence {index + 1}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {safeText(item.file_type)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {safeText(item.description)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No citizen-uploaded evidence is available for this report.
              </p>
            )}
          </Panel>
        </div>

        {/* Evidence records metadata */}
        <div className="mt-5">
          <Panel title="Evidence records">
            {evidence.length > 0 ? (
              <div className="space-y-3">
                {evidence.map((item: any, index: number) => (
                  <div
                    key={item.id || index}
                    className="rounded-lg border border-white/10 p-3"
                  >
                    <p className="font-medium text-slate-200">
                      Evidence {index + 1}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Type: {safeText(item.file_type)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Description: {safeText(item.description)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Uploaded:{" "}
                      {item.uploaded_at
                        ? new Date(item.uploaded_at).toLocaleString()
                        : "Unavailable"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No evidence records available.
              </p>
            )}
          </Panel>
        </div>

        {/* Action brief */}
        <div className="mt-5">
          <Panel title="Evidence-backed action brief">
            {brief.id ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-xl font-semibold">
                    {safeText(brief.title, "Incident action brief")}
                  </h3>

                  <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs text-blue-300">
                    AI generated
                  </span>
                </div>

                <p className="text-sm leading-7 text-slate-300">
                  {safeText(
                    brief.executive_summary,
                    "No summary available."
                  )}
                </p>

                <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
                    Recommended next action
                  </p>

                  <p className="text-sm leading-6 text-slate-200">
                    {safeText(
                      brief.recommended_action,
                      "No action recommendation available."
                    )}
                  </p>
                </div>

                <p className="text-xs text-slate-500">
                  Generated brief ·{" "}
                  {brief.generated_at
                    ? new Date(brief.generated_at).toLocaleString()
                    : "Timestamp unavailable"}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No action brief has been generated for this report.
              </p>
            )}
          </Panel>
        </div>

        <p className="mt-8 text-center text-xs text-slate-600">
          CIVICPROOF · Evidence to Action Intelligence · Human review required
        </p>
      </div>
    </main>
  );
}

export default function InvestigationPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#080e1a] text-slate-300">
          Loading incident investigation...
        </main>
      }
    >
      <InvestigationContent />
    </Suspense>
  );
}


