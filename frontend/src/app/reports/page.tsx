
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

type Report = {
  id: string;
  title: string;
  description: string;
  category: string;
  asset_type?: string | null;
  status: string;
  severity: number | null;
  priority_score: number | null;
  requires_human_review: boolean;
  latitude: number | null;
  longitude: number | null;
  location_text: string | null;
  created_at: string;
};

const API_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

const STATUSES = [
  "submitted",
  "analysing",
  "under_review",
  "verified",
  "assigned",
  "in_progress",
  "resolved",
  "rejected",
];

const CATEGORIES = [
  "road",
  "water",
  "garbage",
  "drainage",
  "streetlight",
  "other",
];

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

function pretty(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string) {
  if (!value) return "Unknown";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id: string) {
  return id ? id.slice(0, 8).toUpperCase() : "UNKNOWN";
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    submitted: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    analysing: "border-violet-400/25 bg-violet-400/10 text-violet-300",
    under_review: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    verified: "border-cyan-400/25 bg-cyan-400/10 text-cyan-300",
    assigned: "border-indigo-400/25 bg-indigo-400/10 text-indigo-300",
    in_progress: "border-blue-400/25 bg-blue-400/10 text-blue-300",
    resolved: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    rejected: "border-red-400/25 bg-red-400/10 text-red-300",
  };

  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-wide ${
        styles[status] || "border-white/10 bg-white/5 text-slate-300"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABELS[status] || pretty(status)}
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: number;
  detail: string;
  icon: string;
  accent: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111b29] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-white/[0.14]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.13em] text-slate-500">
            {label}
          </p>
          <p className={`mt-4 text-3xl font-semibold tracking-tight ${accent}`}>
            {value.toLocaleString("en-IN")}
          </p>
          <p className="mt-2 text-xs text-slate-500">{detail}</p>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-lg">
          {icon}
        </div>
      </div>

      <div className="pointer-events-none absolute -bottom-10 -right-6 h-24 w-24 rounded-full bg-blue-500/[0.035] blur-2xl transition group-hover:bg-blue-400/[0.08]" />
    </div>
  );
}

function SeverityIndicator({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-slate-500">Not analysed</span>;
  }

  const severity = Math.max(0, Math.min(5, Number(value)));
  const color =
    severity >= 4
      ? "text-red-300"
      : severity >= 3
        ? "text-amber-300"
        : "text-emerald-300";

  return (
    <div className="flex items-center gap-2.5">
      <span className={`text-sm font-semibold tabular-nums ${color}`}>
        {severity}/5
      </span>
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, index) => (
          <span
            key={index}
            className={`h-1.5 w-3 rounded-full ${
              index < severity ? "bg-current " + color : "bg-white/10"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const { session, profile, loading: authLoading } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");

  const loadReports = useCallback(async () => {
    if (!session?.access_token || profile?.role !== "admin") return;

    setRefreshing(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/reports`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data.reports)) {
        throw new Error("Unexpected response received from the reports API.");
      }

      setReports(data.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load incident reports.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.access_token, profile?.role]);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (profile?.role !== "admin") {
      router.replace("/my-reports");
      return;
    }
    void loadReports();
  }, [authLoading, session, profile?.role, router, loadReports]);

  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase();

    return reports.filter((report) => {
      const matchesCategory =
        category === "all" || report.category === category;

      const matchesStatus =
        status === "all" || report.status === status;

      const searchableText = [
        report.id,
        report.title,
        report.description,
        report.category,
        report.location_text || "",
      ]
        .join(" ")
        .toLowerCase();

      return (
        matchesCategory &&
        matchesStatus &&
        (!query || searchableText.includes(query))
      );
    });
  }, [reports, search, category, status]);

  const metrics = useMemo(
    () => ({
      total: reports.length,
      analysed: reports.filter((report) => report.severity !== null).length,
      review: reports.filter((report) => report.requires_human_review).length,
      active: reports.filter(
        (report) =>
          report.status !== "resolved" && report.status !== "rejected"
      ).length,
    }),
    [reports]
  );

  function clearFilters() {
    setSearch("");
    setCategory("all");
    setStatus("all");
  }

  const hasFilters =
    search.trim() !== "" || category !== "all" || status !== "all";

  return (
    <main className="min-h-screen bg-[#080d15] px-5 py-7 text-slate-100 md:px-9 md:py-9">
      <div className="mx-auto max-w-[1500px]">
        {/* Top navigation */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
          >
            <span className="text-lg">â†</span>
            <span>Command Centre</span>
          </Link>

          <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#111a26] px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-[11px] font-medium tracking-wide text-slate-400">
              CIVICPROOF WORKSPACE
            </span>
          </div>
        </div>

        {/* Page heading */}
        <section className="flex flex-col justify-between gap-6 border-b border-white/[0.08] pb-7 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-blue-400">
              <span>WORKSPACE</span>
              <span className="text-slate-700">/</span>
              <span className="text-slate-500">INCIDENT MANAGEMENT</span>
            </div>

            <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Incident Reports
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              A central registry of citizen-reported civic issues. Review
              incoming incidents, monitor their workflow, and open individual
              investigations.
            </p>
          </div>

          <button
            onClick={() => void loadReports()}
            disabled={refreshing}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/[0.10] px-5 py-3 text-sm font-semibold text-blue-300 transition hover:border-blue-400/40 hover:bg-blue-500/[0.17] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={refreshing ? "animate-spin" : ""}>↻</span>
            {refreshing ? "Refreshing..." : "Refresh registry"}
          </button>
        </section>

        {/* Metrics */}
        <section className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Total incidents"
            value={metrics.total}
            detail="Reports returned by backend"
            icon="▤"
            accent="text-white"
          />
          <Metric
            label="AI analysed"
            value={metrics.analysed}
            detail="Reports with severity results"
            icon="✳"
            accent="text-violet-300"
          />
          <Metric
            label="Human attention"
            value={metrics.review}
            detail="Flagged for human review"
            icon="◉"
            accent="text-amber-300"
          />
          <Metric
            label="Active incidents"
            value={metrics.active}
            detail="Not resolved or rejected"
            icon="↗"
            accent="text-blue-300"
          />
        </section>

        {/* Registry */}
        <section className="mt-8 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101925]">
          {/* Registry header */}
          <div className="flex flex-col justify-between gap-4 border-b border-white/[0.07] px-5 py-5 md:flex-row md:items-center md:px-6">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-400/15 bg-blue-400/[0.08] text-blue-300">
                  ▤
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Incident registry
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Live records from the CivicProof backend
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400">
                {filteredReports.length}{" "}
                <span className="text-slate-600">/</span> {reports.length}{" "}
                records
              </span>
            </div>
          </div>

          {/* Filters */}
          <div className="border-b border-white/[0.07] bg-[#0d1520] px-5 py-5 md:px-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Search and filter
              </p>

              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs font-medium text-blue-400 transition hover:text-blue-300"
                >
                  Reset all filters ×
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(220px,1.7fr)_1fr_1fr]">
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
                  ⌕
                </span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search incident, description, location or ID..."
                  className="w-full rounded-xl border border-white/[0.09] bg-[#080f19] py-3 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-400/50 focus:ring-2 focus:ring-blue-400/[0.08]"
                />
              </div>

              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="rounded-xl border border-white/[0.09] bg-[#080f19] px-4 py-3 text-sm text-slate-300 outline-none transition focus:border-blue-400/50"
              >
                <option value="all">All categories</option>
                {CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {pretty(item)}
                  </option>
                ))}
              </select>

              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="rounded-xl border border-white/[0.09] bg-[#080f19] px-4 py-3 text-sm text-slate-300 outline-none transition focus:border-blue-400/50"
              >
                <option value="all">All statuses</option>
                {STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {STATUS_LABELS[item]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="m-5 rounded-xl border border-red-400/20 bg-red-400/[0.07] p-4 md:m-6">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm font-semibold text-red-300">
                    Unable to load reports
                  </p>
                  <p className="mt-1 text-xs text-red-200/70">{error}</p>
                </div>

                <button
                  onClick={() => void loadReports()}
                  className="shrink-0 rounded-lg border border-red-300/20 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-400/10"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Loading */}
          {loading ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-400/20 border-t-blue-400" />
              <div>
                <p className="text-sm font-medium text-slate-300">
                  Loading incident registry
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Retrieving records from the backend...
                </p>
              </div>
            </div>
          ) : !error && filteredReports.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-2xl text-slate-500">
                ⌕
              </div>
              <p className="mt-5 text-base font-semibold text-slate-200">
                No reports found
              </p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                {reports.length === 0
                  ? "No reports have been returned by the backend yet."
                  : "No incidents match your current search and filters. Try adjusting your selection."}
              </p>

              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="mt-5 rounded-lg border border-blue-400/20 bg-blue-400/[0.08] px-4 py-2 text-xs font-semibold text-blue-300 transition hover:bg-blue-400/[0.14]"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : !error ? (
            <>
              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px] text-left">
                  <thead>
                    <tr className="border-b border-white/[0.07] bg-[#0d1520] text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">
                      <th className="px-6 py-4">Incident</th>
                      <th className="px-4 py-4">Category</th>
                      <th className="px-4 py-4">Severity</th>
                      <th className="px-4 py-4">Priority</th>
                      <th className="px-4 py-4">Workflow status</th>
                      <th className="px-4 py-4">Reported</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredReports.map((report) => (
                      <tr
                        key={report.id}
                        className="border-b border-white/[0.045] transition-colors last:border-0 hover:bg-white/[0.025]"
                      >
                        <td className="max-w-[360px] px-6 py-5">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-sm text-slate-400">
                              {report.category === "road"
                                ? "▰"
                                : report.category === "water"
                                  ? "◉"
                                  : report.category === "garbage"
                                    ? "▤"
                                    : report.category === "drainage"
                                      ? "≋"
                                      : report.category === "streetlight"
                                        ? "☼"
                                        : "⌖"}
                            </div>

                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-100">
                                {report.title || "Untitled incident"}
                              </p>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                                {report.description ||
                                  "No description supplied."}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-mono text-[10px] tracking-wide text-slate-600">
                                  ID {shortId(report.id)}
                                </span>
                                <span className="text-slate-700">·</span>
                                <span className="max-w-[220px] truncate text-[10px] text-slate-500">
                                  {report.location_text ||
                                    "Location not available"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-5">
                          <span className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5 text-xs text-slate-300">
                            {pretty(report.category || "other")}
                          </span>
                        </td>

                        <td className="px-4 py-5">
                          <SeverityIndicator value={report.severity} />
                        </td>

                        <td className="px-4 py-5">
                          <span className="text-sm font-semibold tabular-nums text-slate-300">
                            {report.priority_score === null
                              ? "—"
                              : Number(report.priority_score).toFixed(1)}
                          </span>
                        </td>

                        <td className="px-4 py-5">
                          <StatusBadge status={report.status} />
                        </td>

                        <td className="whitespace-nowrap px-4 py-5">
                          <p className="text-xs font-medium text-slate-300">
                            {dateLabel(report.created_at).split(",")[0]}
                          </p>
                          <p className="mt-1 text-[10px] text-slate-600">
                            {dateLabel(report.created_at).split(",").slice(1).join(",").trim()}
                          </p>
                        </td>

                        <td className="px-6 py-5 text-right">
                          <Link
                            href={`/investigation/${report.id}`}
                            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-blue-400/20 bg-blue-400/[0.08] px-3.5 py-2.5 text-xs font-semibold text-blue-300 transition hover:border-blue-400/40 hover:bg-blue-400/[0.15]"
                          >
                            Investigate
                            <span>→</span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Table footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] bg-[#0d1520]/60 px-6 py-4">
                <p className="text-xs text-slate-500">
                  Displaying{" "}
                  <span className="font-semibold text-slate-300">
                    {filteredReports.length}
                  </span>{" "}
                  matching incidents
                </p>
                <p className="text-[10px] uppercase tracking-wider text-slate-600">
                  CivicProof · Incident registry
                </p>
              </div>
            </>
          ) : null}
        </section>

        {/* Footer disclaimer */}
        <div className="mt-6 flex flex-col justify-between gap-2 border-t border-white/[0.06] pt-5 sm:flex-row sm:items-center">
          <p className="max-w-3xl text-[11px] leading-5 text-slate-600">
            Incident information is retrieved from the CivicProof backend.
            Internal workflow statuses do not represent confirmed municipal
            action.
          </p>
          <span className="text-[10px] tracking-wide text-slate-700">
            CIVICPROOF / WORKSPACE
          </span>
        </div>
      </div>
    </main>
  );
}

