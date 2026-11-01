
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import IncidentMap from "@/components/IncidentMap";

type Report = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  severity: number | null;
  priority_score: number | null;
  requires_human_review: boolean;
  latitude: number | null;
  longitude: number | null;
  location_text: string | null;
  created_at: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

const categories = [
  "all",
  "road",
  "water",
  "garbage",
  "drainage",
  "streetlight",
  "other",
];

const statuses = [
  "all",
  "submitted",
  "analysing",
  "under_review",
  "verified",
  "assigned",
  "in_progress",
  "resolved",
  "rejected",
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

const STATUS_STYLES: Record<string, string> = {
  submitted: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
  analysing: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  under_review: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  verified: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  assigned: "border-indigo-400/30 bg-indigo-400/10 text-indigo-300",
  in_progress: "border-blue-400/30 bg-blue-400/10 text-blue-300",
  resolved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-red-400/30 bg-red-400/10 text-red-300",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] || label(status);
}

function severityLabel(value: number | null) {
  if (value === null) return "Not analysed";
  if (value >= 4) return "High";
  if (value === 3) return "Moderate";
  return "Low";
}

function StatusBadge({ status }: { status: string }) {
  const style =
    STATUS_STYLES[status] ||
    "border-white/10 bg-white/[0.04] text-zinc-300";

  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-medium ${style}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {statusLabel(status)}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.24em] text-cyan-400">
      {children}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const { session, profile, loading: authLoading } = useAuth();

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);

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
      setReports(data.reports ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to connect to CivicProof API."
      );
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

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const status of statuses) {
      if (status !== "all") counts[status] = 0;
    }

    for (const report of reports) {
      counts[report.status] = (counts[report.status] ?? 0) + 1;
    }

    return counts;
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      const matchesCategory =
        category === "all" || report.category === category;

      const matchesStatus =
        statusFilter === "all" || report.status === statusFilter;

      const text =
        `${report.title} ${report.description} ${report.location_text ?? ""} ${report.category}`.toLowerCase();

      return (
        matchesCategory &&
        matchesStatus &&
        text.includes(search.toLowerCase())
      );
    });
  }, [reports, category, statusFilter, search]);

  const analysed = reports.filter((r) => r.severity !== null).length;

  const awaitingReview = reports.filter(
    (r) => r.requires_human_review
  ).length;

  const highPriority = reports.filter(
    (r) => r.priority_score !== null && r.priority_score >= 70
  ).length;

  const activeIncidents = reports.filter(
    (r) => !["resolved", "rejected"].includes(r.status)
  ).length;

  const statistics = [
    {
      title: "Total reports",
      value: loading ? "—" : reports.length,
      detail: "Records in database",
      icon: "◉",
    },
    {
      title: "AI analysed",
      value: loading ? "—" : analysed,
      detail: "With severity assessment",
      icon: "◇",
    },
    {
      title: "Awaiting review",
      value: loading ? "—" : awaitingReview,
      detail: "Require human attention",
      icon: "◷",
    },
    {
      title: "High priority",
      value: loading ? "—" : highPriority,
      detail: "Priority score ≥ 70",
      icon: "↑",
    },
  ];

  if (authLoading || !session || profile?.role !== "admin") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050607] text-sm text-zinc-400">
        Checking administrator access...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#050607] text-white">
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden w-[252px] shrink-0 flex-col border-r border-white/[0.09] bg-[#08090b] px-5 py-7 lg:flex">
          <Link href="/" className="mb-12 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 font-mono text-lg font-bold text-cyan-300 shadow-[0_0_25px_rgba(0,217,230,0.08)]">
              C
            </div>

            <div>
              <div className="text-lg font-bold tracking-tight">
                CivicProof<span className="text-cyan-400">.</span>
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
                Civic intelligence
              </div>
            </div>
          </Link>

          <SectionLabel>Workspace</SectionLabel>

          <nav className="space-y-1.5">
            <Link
              href="/"
              className="flex items-center gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] px-4 py-3 text-sm font-medium text-cyan-300"
            >
              <span className="text-base">▦</span>
              Command Centre
            </Link>

            <Link
              href="/reports"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              <span>◉</span>
              Incident Reports
            </Link>

            <Link
              href="/clusters"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              <span>⌖</span>
              Incident Clusters
            </Link>

            <Link
              href="/ai-investigation"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              <span>◇</span>
              AI Investigation
            </Link>

            <Link
              href="/action-briefs"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              <span>▤</span>
              Action Briefs
            </Link>
          </nav>

          <div className="mt-10 border-t border-white/[0.08] pt-6">
            <SectionLabel>Public portal</SectionLabel>

            <nav className="space-y-1.5">
              <Link
                href="/report"
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-cyan-300"
              >
                <span>＋</span>
                File a report
              </Link>
            </nav>
          </div>

          <div className="mt-auto rounded-xl border border-white/[0.09] bg-white/[0.025] p-4">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,217,230,0.8)]" />
              System status
            </div>

            <p className="text-xs leading-5 text-zinc-500">
              Incident data is retrieved from the live CivicProof database.
            </p>

            <div className="mt-4 border-t border-white/[0.08] pt-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
                Pilot jurisdiction
              </div>
              <div className="mt-1 text-xs text-zinc-300">
                Pune Municipal Corporation
              </div>
              <div className="mt-2 text-[10px] text-amber-400/80">
                Routing rules pending verification
              </div>
            </div>
          </div>

          <div className="mt-5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-700">
            CivicProof / Operations
          </div>
        </aside>

        {/* Main content */}
        <section className="min-w-0 flex-1">
          {/* Header */}
          <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.09] bg-[#050607]/90 px-5 py-4 backdrop-blur-xl md:px-9">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                CivicProof / Operations
              </div>
              <h1 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
                Command Centre
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-cyan-300 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,217,230,0.8)]" />
                API connected
              </div>

              <button
                onClick={() => void loadReports()}
                disabled={refreshing}
                className="rounded-lg border border-white/[0.12] bg-white/[0.04] px-4 py-2.5 text-xs font-medium text-zinc-300 transition hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
              >
                {refreshing ? "Refreshing..." : "↻ Refresh data"}
              </button>
            </div>
          </header>

          <div className="space-y-8 px-5 py-8 md:px-9">
            {/* Page introduction */}
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div>
                <SectionLabel>Infrastructure intelligence</SectionLabel>
                <h2 className="text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
                  Incident overview<span className="text-cyan-400">.</span>
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500">
                  Monitor, investigate and prioritise citizen-reported civic
                  infrastructure issues.
                </p>
              </div>

              <div className="min-w-[190px] rounded-xl border border-white/[0.09] bg-white/[0.025] px-4 py-3">
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                  Operating jurisdiction
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-200">
                  Pune, Maharashtra
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-300">
                <div className="font-semibold">API connection failed</div>
                <p className="mt-1 text-xs text-red-300/80">{error}</p>
                <button
                  onClick={() => void loadReports()}
                  className="mt-3 text-xs underline underline-offset-4"
                >
                  Retry connection
                </button>
              </div>
            )}

            {/* Statistics */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {statistics.map((stat, index) => (
                <div
                  key={stat.title}
                  className="group rounded-xl border border-white/[0.09] bg-[#0a0c0f] p-5 transition hover:border-cyan-300/25"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">
                      {stat.title}
                    </span>
                    <span className="font-mono text-lg text-cyan-400">
                      {stat.icon}
                    </span>
                  </div>

                  <div className="mt-5 font-mono text-3xl font-medium tracking-tight text-white">
                    {stat.value}
                  </div>

                  <div className="mt-2 text-[11px] text-zinc-600">
                    {stat.detail}
                  </div>

                  <div className="mt-5 h-px w-full bg-white/[0.06]">
                    <div
                      className={`h-px transition-all ${
                        index === 0
                          ? "w-full bg-cyan-400/70"
                          : index === 1
                            ? "w-2/3 bg-cyan-400/50"
                            : index === 2
                              ? "w-1/2 bg-cyan-400/40"
                              : "w-1/3 bg-cyan-400/40"
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Workflow */}
            <section className="rounded-xl border border-white/[0.09] bg-[#0a0c0f] p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <SectionLabel>Operational pipeline</SectionLabel>
                  <h3 className="text-lg font-semibold tracking-tight">
                    Incident workflow
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Distribution across internal CivicProof workflow states
                  </p>
                </div>

                <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-xs text-zinc-400">
                  <span className="font-mono text-cyan-300">
                    {loading ? "—" : activeIncidents}
                  </span>{" "}
                  active incidents
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                {statuses
                  .filter((status) => status !== "all")
                  .map((status) => (
                    <button
                      key={status}
                      onClick={() =>
                        setStatusFilter(
                          statusFilter === status ? "all" : status
                        )
                      }
                      className={`rounded-lg border p-3 text-left transition ${
                        statusFilter === status
                          ? "border-cyan-400/40 bg-cyan-400/[0.08]"
                          : "border-white/[0.07] bg-white/[0.015] hover:border-white/20 hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="min-h-8 text-[10px] leading-4 text-zinc-500">
                        {statusLabel(status)}
                      </div>
                      <div className="mt-2 font-mono text-xl font-medium tabular-nums text-white">
                        {loading ? "—" : statusCounts[status] ?? 0}
                      </div>
                    </button>
                  ))}
              </div>

              <p className="mt-4 border-t border-white/[0.07] pt-4 text-[10px] leading-5 text-zinc-600">
                Select a stage to filter the incident registry. These are
                internal CivicProof workflow states, not confirmations of
                municipal action.
              </p>
            </section>

            {/* Live map */}
            <section>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <SectionLabel>Geospatial intelligence</SectionLabel>
                  <h3 className="text-lg font-semibold tracking-tight">
                    Incident map
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Geographic view of reports with available coordinates
                  </p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  Live report locations
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#0a0c0f]">
                <IncidentMap />
              </div>
            </section>

            {/* Incident registry */}
            <section className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#0a0c0f]">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] p-5 md:p-6">
                <div>
                  <SectionLabel>Evidence database</SectionLabel>
                  <h3 className="text-lg font-semibold tracking-tight">
                    Incident registry
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Live records retrieved from the CivicProof API
                  </p>
                </div>

                <div className="rounded-lg border border-white/[0.09] bg-white/[0.025] px-3 py-2 font-mono text-xs text-zinc-400">
                  {filteredReports.length} records
                </div>
              </div>

              {/* Search and filters */}
              <div className="grid gap-3 border-b border-white/[0.07] p-4 md:grid-cols-[1fr_180px_180px]">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search incidents, descriptions, locations..."
                  className="min-w-0 rounded-lg border border-white/[0.1] bg-[#050607] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 transition focus:border-cyan-400/50"
                />

                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="rounded-lg border border-white/[0.1] bg-[#050607] px-4 py-3 text-sm text-zinc-300 outline-none focus:border-cyan-400/50"
                >
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item === "all" ? "All categories" : label(item)}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-white/[0.1] bg-[#050607] px-4 py-3 text-sm text-zinc-300 outline-none focus:border-cyan-400/50"
                >
                  <option value="all">
                    All statuses ({reports.length})
                  </option>
                  {statuses
                    .filter((status) => status !== "all")
                    .map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)} ({statusCounts[status] ?? 0})
                      </option>
                    ))}
                </select>
              </div>

              {/* Active filters */}
              {(category !== "all" ||
                statusFilter !== "all" ||
                search.trim() !== "") && (
                <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.07] px-5 py-3">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                    Active filters
                  </span>

                  {category !== "all" && (
                    <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-300">
                      {label(category)}
                    </span>
                  )}

                  {statusFilter !== "all" && (
                    <span className="rounded-md border border-cyan-400/20 bg-cyan-400/[0.06] px-2 py-1 text-[10px] text-cyan-300">
                      {statusLabel(statusFilter)}
                    </span>
                  )}

                  {search.trim() !== "" && (
                    <span className="max-w-full truncate rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-300">
                      Search: {search}
                    </span>
                  )}

                  <button
                    onClick={() => {
                      setCategory("all");
                      setStatusFilter("all");
                      setSearch("");
                    }}
                    className="ml-auto text-[11px] text-cyan-400 transition hover:text-cyan-200"
                  >
                    Clear filters ×
                  </button>
                </div>
              )}

              {/* Report records */}
              {loading ? (
                <div className="p-14 text-center">
                  <div className="font-mono text-xs uppercase tracking-widest text-cyan-300">
                    Loading live incidents...
                  </div>
                  <p className="mt-2 text-xs text-zinc-600">
                    Retrieving records from the database
                  </p>
                </div>
              ) : filteredReports.length === 0 ? (
                <div className="p-14 text-center">
                  <div className="text-sm font-medium text-zinc-300">
                    No incidents found
                  </div>
                  <p className="mt-2 text-xs text-zinc-600">
                    No records match the current search and filters.
                  </p>
                  <button
                    onClick={() => {
                      setCategory("all");
                      setStatusFilter("all");
                      setSearch("");
                    }}
                    className="mt-4 text-xs text-cyan-400 hover:text-cyan-200"
                  >
                    Clear all filters
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left">
                    <thead className="bg-white/[0.025] font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                      <tr>
                        <th className="px-5 py-4 font-medium">Incident</th>
                        <th className="px-4 py-4 font-medium">Category</th>
                        <th className="px-4 py-4 font-medium">Severity</th>
                        <th className="px-4 py-4 font-medium">Priority</th>
                        <th className="px-4 py-4 font-medium">Status</th>
                        <th className="px-5 py-4 font-medium">Reported</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredReports.map((report) => (
                        <tr
                          key={report.id}
                          onClick={() =>
                            (window.location.href = `/investigation/${report.id}`)
                          }
                          className="cursor-pointer transition hover:bg-cyan-400/[0.035]"
                        >
                          <td className="max-w-[310px] px-5 py-4">
                            <div className="truncate text-sm font-medium text-zinc-200">
                              {report.title}
                            </div>
                            <div className="mt-1 truncate text-xs text-zinc-600">
                              {report.location_text ||
                                "Location not provided"}
                            </div>
                          </td>

                          <td className="px-4 py-4">
                            <span className="rounded-md border border-white/[0.1] bg-white/[0.025] px-2.5 py-1.5 text-[10px] text-zinc-300">
                              {label(report.category)}
                            </span>
                          </td>

                          <td className="px-4 py-4 text-xs">
                            {report.severity === null ? (
                              <span className="text-zinc-600">Pending</span>
                            ) : (
                              <span className="text-zinc-300">
                                {severityLabel(report.severity)} (
                                {report.severity}/5)
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-4">
                            {report.priority_score === null ? (
                              <span className="text-xs text-zinc-600">
                                Pending
                              </span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
                                  <div
                                    className="h-full rounded-full bg-cyan-400"
                                    style={{
                                      width: `${Math.min(
                                        100,
                                        Math.max(
                                          0,
                                          Number(report.priority_score)
                                        )
                                      )}%`,
                                    }}
                                  />
                                </div>
                                <span className="font-mono text-[11px] tabular-nums text-zinc-300">
                                  {Number(
                                    report.priority_score
                                  ).toFixed(2)}
                                </span>
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-4">
                            <div className="flex flex-col items-start gap-1.5">
                              <StatusBadge status={report.status} />
                              {report.requires_human_review && (
                                <span className="text-[10px] text-amber-400">
                                  Review required
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 font-mono text-[10px] text-zinc-500">
                            {formatDate(report.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Footer */}
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-700">
              <span>CivicProof / Evidence-to-action intelligence</span>
              <span>Development environment / PMC pilot</span>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}


