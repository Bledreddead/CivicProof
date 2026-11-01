"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

type Report = {
  id: string;
  title: string;
  description: string;
  category: string;
  asset_type: string;
  status: string;
  severity: string;
  priority_score: number;
  requires_human_review: boolean;
  latitude: number | null;
  longitude: number | null;
  location_text: string | null;
  created_at: string;
};

function statusStyle(status: string) {
  const value = status.toLowerCase();

  if (value.includes("resolved") || value.includes("closed")) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }

  if (value.includes("progress") || value.includes("investigat")) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }

  return "border-cyan-500/30 bg-cyan-500/10 text-cyan-300";
}

export default function MyReportsPage() {
  const router = useRouter();
  const { session, profile, loading } = useAuth();

  const [reports, setReports] = useState<Report[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const fetchReports = useCallback(async () => {
    if (!session?.access_token) return;

    setFetching(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/reports`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "Your session has expired. Please sign in again."
            : "Could not load your reports."
        );
      }

      const result = await response.json();
      setReports(result.reports ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setFetching(false);
    }
  }, [session]);

  useEffect(() => {
    if (loading) return;

    if (!session) {
      router.replace("/login");
      return;
    }

    if (profile?.role === "admin") {
      router.replace("/");
      return;
    }

    if (profile?.role === "citizen") {
      void fetchReports();
    }
  }, [loading, session, profile, router, fetchReports]);

  if (loading || !session || !profile || profile.role !== "citizen") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        Checking your account...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <Link
              href="/my-reports"
              className="text-sm font-bold tracking-widest text-cyan-400"
            >
              CIVICPROOF
            </Link>
            <h1 className="mt-3 text-3xl font-bold">My Reports</h1>
            <p className="mt-1 text-sm text-slate-400">
              Track the civic issues you have submitted.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void fetchReports()}
              disabled={fetching}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Refresh
            </button>

            <Link
              href="/report"
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
            >
              + Submit report
            </Link>
          </div>
        </header>

        <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Total submitted</p>
            <p className="mt-2 text-3xl font-bold">{reports.length}</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Under investigation</p>
            <p className="mt-2 text-3xl font-bold">
              {
                reports.filter((report) =>
                  report.status.toLowerCase().includes("investigat") ||
                  report.status.toLowerCase().includes("progress")
                ).length
              }
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Resolved</p>
            <p className="mt-2 text-3xl font-bold">
              {
                reports.filter((report) =>
                  report.status.toLowerCase().includes("resolved") ||
                  report.status.toLowerCase().includes("closed")
                ).length
              }
            </p>
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Your submissions</h2>
            <span className="text-sm text-slate-500">
              {reports.length} report(s)
            </span>
          </div>

          {fetching ? (
            <div className="rounded-xl border border-white/10 bg-slate-900 p-10 text-center text-slate-400">
              Loading your reports...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-300">
              {error}
              <button
                onClick={() => void fetchReports()}
                className="ml-3 underline"
              >
                Try again
              </button>
            </div>
          ) : reports.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-16 text-center">
              <h3 className="text-lg font-semibold">No reports yet</h3>
              <p className="mt-2 text-sm text-slate-400">
                When you report a civic issue, it will appear here.
              </p>
              <Link
                href="/report"
                className="mt-6 inline-block rounded-lg bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Submit your first report
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {reports.map((report) => (
                <article
                  key={report.id}
                  className="rounded-xl border border-white/10 bg-slate-900 p-5 transition hover:border-slate-600"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">
                        {report.title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Submitted{" "}
                        {new Date(report.created_at).toLocaleString()}
                      </p>
                    </div>

                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${statusStyle(report.status)}`}
                    >
                      {report.status.replaceAll("_", " ")}
                    </span>
                  </div>

                  <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-400">
                    {report.description}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                    <span>Category: {report.category}</span>
                    <span>Severity: {report.severity}</span>
                    {report.location_text && (
                      <span>Location: {report.location_text}</span>
                    )}
                  </div>

                  <div className="mt-5 border-t border-white/10 pt-4">
                    <Link
                      href={`/investigation/${report.id}`}
                      className="text-sm font-semibold text-cyan-400 hover:text-cyan-300"
                    >
                      View report details →
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="mt-12 border-t border-white/10 pt-5 text-xs text-slate-600">
          CivicProof · Citizen reporting portal
        </footer>
      </div>
    </main>
  );
}