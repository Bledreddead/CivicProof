
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
  status: string;
  severity: number | null;
  priority_score: number | null;
  requires_human_review: boolean;
  location_text: string | null;
  created_at: string;
};

const API_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityLabel(value: number | null) {
  if (value === null) return "Pending";
  if (value >= 4) return "High";
  if (value === 3) return "Moderate";
  return "Low";
}

function SeverityBadge({ severity }: { severity: number | null }) {
  const styles =
    severity === null
      ? "border-slate-400/20 bg-slate-400/10 text-slate-400"
      : severity >= 4
      ? "border-red-400/20 bg-red-400/10 text-red-300"
      : severity === 3
      ? "border-amber-400/20 bg-amber-400/10 text-amber-300"
      : "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";

  return (
    <span className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${styles}`}>
      {severityLabel(severity)}
      {severity !== null ? ` · ${severity}/5` : ""}
    </span>
  );
}

export default function AIInvestigationPage() {
  const router = useRouter();
  const { session, profile, loading: authLoading } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const loadReports = useCallback(async () => {
    if (!session?.access_token) return;
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
          : "Unable to load incidents from CivicProof API."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.access_token]);

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

  const analysedCount = reports.filter(
    (report) => report.severity !== null
  ).length;

  const pendingCount = reports.length - analysedCount;

  const reviewCount = reports.filter(
    (report) => report.requires_human_review
  ).length;

  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      const query = search.trim().toLowerCase();

      const matchesSearch =
        !query ||
        `${report.title} ${report.description} ${report.category} ${report.location_text ?? ""}`
          .toLowerCase()
          .includes(query);

      const matchesFilter =
        filter === "all" ||
        (filter === "analysed" && report.severity !== null) ||
        (filter === "pending" && report.severity === null) ||
        (filter === "review" && report.requires_human_review);

      return matchesSearch && matchesFilter;
    });
  }, [reports, search, filter]);

  return (
    <main className="min-h-screen bg-[#090d14] text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-[250px] shrink-0 border-r border-white/10 bg-[#0d131d] px-5 py-7 lg:flex lg:flex-col">
          <div className="mb-12 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500 text-lg font-black">
              C
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">CivicProof</div>
              <div className="text-[10px] uppercase tracking-[2px] text-slate-500">
                Civic intelligence
              </div>
            </div>
          </div>

          <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[2px] text-slate-500">
            Workspace
          </div>

          <nav className="space-y-2">
            <Link href="/" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200">
              <span>▦</span> Command Centre
            </Link>

            <Link href="/reports" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200">
              <span>◉</span> Incident Reports
            </Link>

            <Link href="/clusters" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200">
              <span>⌖</span> Incident Clusters
            </Link>

            <div className="flex items-center gap-3 rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm font-medium text-blue-300">
              <span>◇</span> AI Investigation
            </div>

            <Link href="/action-briefs" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200">
              <span>▤</span> Action Briefs
            </Link>
          </nav>

          <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              SYSTEM STATUS
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Incident records are retrieved from the live CivicProof API.
            </p>
            <div className="mt-4 border-t border-white/10 pt-3 text-[10px] text-slate-600">
              PILOT JURISDICTION
              <div className="mt-1 text-xs text-slate-300">
                Pune Municipal Corporation
              </div>
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-5 md:px-9">
            <div>
              <div className="text-xs text-slate-500">
                CivicProof / Workspace / AI
              </div>
              <h1 className="mt-1 text-xl font-bold tracking-tight md:text-2xl">
                AI Investigation
              </h1>
            </div>

            <button
              onClick={() => void loadReports()}
              disabled={refreshing}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
            >
              {refreshing ? "Refreshing..." : "↻ Refresh"}
            </button>
          </header>

          <div className="space-y-7 px-5 py-7 md:px-9">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[2px] text-blue-400">
                Multimodal intelligence
              </div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
                Investigation workspace
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Select a reported civic incident to inspect its saved AI
                assessment, uploaded evidence, severity, potential risks,
                duplicate matches and department recommendation.
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">
                Could not load incidents: {error}
                <button
                  onClick={() => void loadReports()}
                  className="ml-3 underline"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-[#101824] p-5">
                <div className="text-xs text-slate-400">Total incidents</div>
                <div className="mt-3 text-3xl font-bold">
                  {loading ? "—" : reports.length}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Live database records
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#101824] p-5">
                <div className="text-xs text-slate-400">AI assessed</div>
                <div className="mt-3 text-3xl font-bold text-violet-300">
                  {loading ? "—" : analysedCount}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Reports with a saved severity assessment
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#101824] p-5">
                <div className="text-xs text-slate-400">Human review required</div>
                <div className="mt-3 text-3xl font-bold text-amber-300">
                  {loading ? "—" : reviewCount}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Flagged for human attention
                </div>
              </div>
            </div>

            <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#101824]">
              <div className="border-b border-white/10 p-5">
                <h3 className="font-semibold">Select an incident</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Open an incident to inspect its existing investigation.
                </p>
              </div>

              <div className="grid gap-3 border-b border-white/10 p-4 md:grid-cols-[1fr_220px]">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search title, description or location..."
                  className="min-w-0 rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 text-sm outline-none placeholder:text-slate-600 focus:border-blue-400/50"
                />

                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  className="rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 text-sm text-slate-300 outline-none focus:border-blue-400/50"
                >
                  <option value="all">All incidents</option>
                  <option value="analysed">AI assessed</option>
                  <option value="pending">Analysis pending</option>
                  <option value="review">Human review required</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-5 py-3">
                <span className="text-xs text-slate-500">
                  {loading ? "Loading..." : `${filteredReports.length} incidents`}
                </span>
                <span className="text-[11px] text-slate-600">
                  {pendingCount} pending assessment
                </span>
              </div>

              {loading ? (
                <div className="p-12 text-center text-sm text-slate-500">
                  Loading incidents from CivicProof...
                </div>
              ) : filteredReports.length === 0 ? (
                <div className="p-12 text-center text-sm text-slate-500">
                  No incidents match your search or filter.
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {filteredReports.map((report) => (
                    <div
                      key={report.id}
                      className="flex flex-col gap-4 p-5 transition hover:bg-white/[0.025] md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-200">
                            {report.title}
                          </h4>
                          <SeverityBadge severity={report.severity} />
                        </div>

                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                          {report.description}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-slate-500">
                          <span>{formatLabel(report.category)}</span>
                          <span>{formatLabel(report.status)}</span>
                          <span>
                            {report.location_text || "Location not provided"}
                          </span>
                        </div>

                        {report.requires_human_review && (
                          <div className="mt-3 text-[11px] font-medium text-amber-400">
                            Human review required
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
                        <Link
                          href={`/investigation/${report.id}`}
                          className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-2.5 text-center text-xs font-semibold text-blue-300 transition hover:bg-blue-500/20"
                        >
                          Open investigation →
                        </Link>
                        <div className="text-center text-[10px] text-slate-600">
                          {report.severity !== null
                            ? "Saved AI assessment"
                            : "Assessment not available"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-[11px] leading-5 text-slate-500">
              AI assessments are decision-support outputs, not verified
              findings. Human review remains necessary before treating an
              observation or recommendation as confirmed.
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-[11px] text-slate-600">
              <span>CIVICPROOF · EVIDENCE-TO-ACTION INTELLIGENCE</span>
              <span>Development environment · PMC pilot</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

