
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const API =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

type Report = {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  status?: string;
  location_text?: string;
  created_at?: string;
};

type ActionBrief = {
  id?: string;
  report_id?: string;
  title?: string;
  executive_summary?: string;
  recommended_action?: string;
  evidence_summary?: unknown;
  priority_explanation?: unknown;
  generated_at?: string;
  department_id?: string;
};

type InvestigationResponse = {
  report?: Report;
  latest_brief?: ActionBrief | null;
  route?: {
    department?: {
      name?: string;
    };
    department_name?: string;
    name?: string;
  } | null;
};

type BriefItem = {
  report: Report;
  brief: ActionBrief;
  departmentName?: string;
};

function formatDate(value?: string) {
  if (!value) return "Date unavailable";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return date.toLocaleString();
}

function prettyCategory(value?: string) {
  if (!value) return "Uncategorised";
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ActionBriefsPage() {
  const router = useRouter();
  const { session, profile, loading: authLoading } = useAuth();
  const [items, setItems] = useState<BriefItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!session?.access_token) {
      router.replace("/login");
      return;
    }
    if (profile?.role !== "admin") {
      router.replace("/my-reports");
      return;
    }
    let cancelled = false;

    async function loadBriefs() {
      setLoading(true);
      setError("");

      try {
        const reportsResponse = await fetch(`${API}/reports`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });

        if (!reportsResponse.ok) {
          throw new Error("Could not load reports from the backend.");
        }

        const reportsData = await reportsResponse.json();
        const reports: Report[] = reportsData.reports ?? [];

        const results = await Promise.allSettled(
          reports.map(async (report) => {
            const response = await fetch(
              `${API}/reports/${report.id}/investigation`,
              { headers: { Authorization: `Bearer ${session?.access_token}` } }
            );

            if (!response.ok) {
              throw new Error(`Could not load investigation ${report.id}`);
            }

            const data: InvestigationResponse = await response.json();
            const brief = data.latest_brief;

            if (!brief) return null;

            return {
              report,
              brief,
              departmentName:
                data.route?.department?.name ||
                data.route?.department_name ||
                data.route?.name,
            } satisfies BriefItem;
          })
        );

        const found: BriefItem[] = [];

        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            found.push(result.value);
          }
        }

        found.sort((a, b) => {
          const dateA = new Date(
            a.brief.generated_at || a.report.created_at || 0
          ).getTime();
          const dateB = new Date(
            b.brief.generated_at || b.report.created_at || 0
          ).getTime();

          return dateB - dateA;
        });

        if (!cancelled) setItems(found);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Something went wrong."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBriefs();

    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.access_token, profile?.role, router]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;

    return items.filter(({ report, brief, departmentName }) =>
      [
        report.title,
        report.description,
        report.category,
        report.location_text,
        brief.title,
        brief.executive_summary,
        brief.recommended_action,
        departmentName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [items, search]);

  return (
    <main className="min-h-screen bg-[#080d19] text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-white/[0.07] bg-[#0b1220] p-5 lg:flex lg:flex-col">
          <div className="mb-10">
            <div className="text-xl font-bold tracking-tight text-white">
              Civic<span className="text-cyan-400">Proof</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Civic intelligence workspace
            </div>
          </div>

          <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
            Workspace
          </div>

          <nav className="space-y-1 text-sm">
            <Link
              href="/"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              <span>⌂</span> Command Centre
            </Link>
            <Link
              href="/reports"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              <span>◉</span> Incident Reports
            </Link>
            <Link
              href="/clusters"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              <span>⌘</span> Incident Clusters
            </Link>
            <Link
              href="/ai-investigation"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              <span>◇</span> AI Investigation
            </Link>
            <Link
              href="/action-briefs"
              className="flex items-center gap-3 rounded-xl border border-cyan-400/10 bg-cyan-400/[0.08] px-4 py-3 text-cyan-300"
            >
              <span>▤</span> Action Briefs
            </Link>
          </nav>

          <div className="mt-auto rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="text-xs font-medium text-slate-300">
              Evidence-led governance
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              AI-generated recommendations support human review. They do not
              represent official municipal decisions.
            </p>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] px-6 py-5 lg:px-9">
            <div>
              <div className="text-xs text-slate-500">
                Workspace / Action Briefs
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Action Briefs
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Evidence-backed recommendations generated from incident
                investigations.
              </p>
            </div>

            <Link
              href="/reports"
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/[0.05]"
            >
              View incident reports →
            </Link>
          </header>

          <div className="space-y-6 p-6 lg:p-9">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/[0.07] bg-[#101a2b] p-5">
                <div className="text-xs text-slate-500">
                  Generated action briefs
                </div>
                <div className="mt-2 text-3xl font-semibold text-white">
                  {loading ? "—" : items.length}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Based on available report investigations
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.07] bg-[#101a2b] p-5">
                <div className="text-xs text-slate-500">
                  Matching your search
                </div>
                <div className="mt-2 text-3xl font-semibold text-white">
                  {loading ? "—" : filteredItems.length}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Currently displayed briefs
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search briefs, incidents, departments..."
                className="w-full rounded-xl border border-white/10 bg-[#101a2b] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/40"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-400 hover:bg-white/[0.05]"
                >
                  Clear
                </button>
              )}
            </div>

            {loading && (
              <div className="rounded-2xl border border-white/[0.07] bg-[#101a2b] p-10 text-center">
                <div className="text-sm text-slate-300">
                  Loading action briefs...
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Retrieving the latest investigation records.
                </p>
              </div>
            )}

            {!loading && error && (
              <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.05] p-5">
                <div className="font-medium text-red-300">
                  Unable to load action briefs
                </div>
                <p className="mt-2 text-sm text-slate-400">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-4 rounded-lg border border-red-300/20 px-3 py-2 text-xs text-red-200 hover:bg-red-300/10"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && filteredItems.length === 0 && (
              <div className="rounded-2xl border border-white/[0.07] bg-[#101a2b] px-6 py-14 text-center">
                <div className="text-3xl text-slate-600">▤</div>
                <h2 className="mt-4 text-lg font-medium text-slate-200">
                  {items.length === 0
                    ? "No action briefs generated yet"
                    : "No matching briefs"}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
                  {items.length === 0
                    ? "Action briefs will appear here after an incident investigation successfully generates and saves one."
                    : "Try another search term or clear your search."}
                </p>
                {items.length === 0 && (
                  <Link
                    href="/reports"
                    className="mt-5 inline-flex rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-2.5 text-sm text-cyan-300 hover:bg-cyan-400/[0.12]"
                  >
                    Open incident reports →
                  </Link>
                )}
              </div>
            )}

            {!loading && !error && filteredItems.length > 0 && (
              <div className="space-y-4">
                {filteredItems.map(({ report, brief, departmentName }) => (
                  <article
                    key={brief.id || `${report.id}-${brief.generated_at}`}
                    className="rounded-2xl border border-white/[0.07] bg-[#101a2b] p-5 transition hover:border-cyan-400/20 sm:p-6"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400">
                          Action brief
                        </div>
                        <h2 className="mt-2 text-lg font-semibold text-white">
                          {brief.title || report.title || "Incident action brief"}
                        </h2>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>{prettyCategory(report.category)}</span>
                          <span>·</span>
                          <span>{report.location_text || "Location unavailable"}</span>
                        </div>
                      </div>

                      <span className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-400">
                        {formatDate(brief.generated_at)}
                      </span>
                    </div>

                    {brief.executive_summary && (
                      <div className="mt-5">
                        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Executive summary
                        </div>
                        <p className="mt-2 text-sm leading-7 text-slate-300">
                          {brief.executive_summary}
                        </p>
                      </div>
                    )}

                    {brief.recommended_action && (
                      <div className="mt-5 rounded-xl border border-cyan-400/10 bg-cyan-400/[0.04] p-4">
                        <div className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
                          Recommended action
                        </div>
                        <p className="mt-2 text-sm leading-7 text-slate-200">
                          {brief.recommended_action}
                        </p>
                      </div>
                    )}

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
                      <div className="text-xs text-slate-500">
                        {departmentName
                          ? `Suggested department: ${departmentName}`
                          : "Department recommendation available in investigation"}
                      </div>
                      <Link
                        href={`/investigation/${report.id}`}
                        className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-cyan-400/30 hover:text-cyan-300"
                      >
                        Open full investigation →
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <p className="text-center text-[11px] leading-relaxed text-slate-600">
              Action briefs are AI-generated decision-support documents.
              Recommendations require appropriate human and departmental
              verification before any real-world action.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}


