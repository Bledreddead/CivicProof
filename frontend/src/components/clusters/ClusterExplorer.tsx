
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

import {
  getCluster,
  getClusters,
  requestClustering,
} from "@/lib/cluster-api";

import type {
  ClusterReport,
  IncidentCluster,
} from "@/types/cluster";

type StatusFilter = "all" | "candidate" | "confirmed" | "dismissed";

function Icon({
  name,
  size = 18,
}: {
  name: "refresh" | "search" | "arrow" | "close" | "pin" | "layers";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  if (name === "refresh") {
    return (
      <svg {...common}>
        <path d="M20 7v5h-5" />
        <path d="M4 17v-5h5" />
        <path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" />
      </svg>
    );
  }

  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 4.5 4.5" />
      </svg>
    );
  }

  if (name === "arrow") {
    return (
      <svg {...common}>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    );
  }

  if (name === "close") {
    return (
      <svg {...common}>
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    );
  }

  if (name === "pin") {
    return (
      <svg {...common}>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}

function titleOf(cluster: IncidentCluster) {
  return cluster.title?.trim() || "Untitled incident cluster";
}

function reportsOf(cluster?: IncidentCluster | null): ClusterReport[] {
  if (!cluster) return [];

  if (Array.isArray(cluster.reports)) {
    return cluster.reports;
  }

  if (Array.isArray(cluster.members)) {
    return cluster.members.map((member) => ({
      ...(member.report ?? {}),
      id: member.report?.id ?? member.report_id ?? undefined,
      similarity_score:
        member.report?.similarity_score ?? member.similarity_score,
      distance_meters:
        member.report?.distance_meters ?? member.distance_meters,
    }));
  }

  return [];
}

function countOf(cluster: IncidentCluster) {
  return (
    cluster.member_count ??
    cluster.report_count ??
    reportsOf(cluster).length
  );
}

function dateOf(value?: string | null) {
  if (!value) return "Date unavailable";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
      }).format(date);
}

function statusClass(status?: string | null) {
  if (status === "confirmed") return "status-confirmed";
  if (status === "dismissed") return "status-dismissed";
  return "status-candidate";
}

function displayStatus(status?: string | null) {
  if (!status) return "Unknown status";

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDistance(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;

  return value >= 1000
    ? `${(value / 1000).toFixed(1)} km`
    : `${Math.round(value)} m`;
}

function formatScore(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;

  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

export default function ClusterExplorer() {
  const router = useRouter();
  const { session, profile, loading: authLoading } = useAuth();

  const [clusters, setClusters] = useState<IncidentCluster[]>([]);
  const [selected, setSelected] = useState<IncidentCluster | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState("all");

  const [reportId, setReportId] = useState("");
  const [clusterBusy, setClusterBusy] = useState(false);

  const [actionMessage, setActionMessage] = useState<{
    kind: "success" | "empty" | "error";
    text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!session?.access_token) return;

    setLoading(true);
    setError("");

    try {
      const data = await getClusters(session.access_token);
      setClusters(data);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load clusters."
      );
    } finally {
      setLoading(false);
    }
  }, [session]);

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

    void refresh();
  }, [authLoading, session, profile, router, refresh]);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          clusters
            .map((item) => item.category?.trim())
            .filter((item): item is string => Boolean(item))
        )
      ).sort(),
    [clusters]
  );

  const visibleClusters = useMemo(() => {
    return clusters.filter((item) => {
      const query = search.trim().toLowerCase();

      const matchesText =
        !query ||
        `${item.title ?? ""} ${item.category ?? ""}`
          .toLowerCase()
          .includes(query);

      return (
        matchesText &&
        (status === "all" || item.status === status) &&
        (category === "all" || item.category === category)
      );
    });
  }, [clusters, search, status, category]);

  const totals = useMemo(
    () => ({
      all: clusters.length,
      candidate: clusters.filter(
        (item) => item.status === "candidate"
      ).length,
      confirmed: clusters.filter(
        (item) => item.status === "confirmed"
      ).length,
      dismissed: clusters.filter(
        (item) => item.status === "dismissed"
      ).length,
    }),
    [clusters]
  );

  async function openCluster(cluster: IncidentCluster) {
    setSelected(cluster);
    setDetailLoading(true);

    try {
      if (!session?.access_token) return;

      const detail = await getCluster(cluster.id, session.access_token);
      setSelected(detail);
    } catch (cause) {
      setSelected(cluster);

      setActionMessage({
        kind: "error",
        text:
          cause instanceof Error
            ? `Could not load cluster details: ${cause.message}`
            : "Could not load cluster details.",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitClustering(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const id = reportId.trim();

    if (!id) return;

    setClusterBusy(true);
    setActionMessage(null);

    try {
      if (!session?.access_token) return;

      const result = await requestClustering(id, session.access_token);
      const text = JSON.stringify(result).toLowerCase();

      const noMatch = [
        "no cluster",
        "no_cluster",
        "no eligible",
        "no matches",
        "no reports",
        "no_candidate",
      ].some((phrase) => text.includes(phrase));

      setActionMessage({
        kind: noMatch ? "empty" : "success",
        text: noMatch
          ? "No eligible nearby and semantically similar reports were found."
          : "Clustering request completed. Refresh the cluster list to see any updates.",
      });

      if (!noMatch) {
        await refresh();
      }
    } catch (cause) {
      setActionMessage({
        kind: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "The clustering request failed.",
      });
    } finally {
      setClusterBusy(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setStatus("all");
    setCategory("all");
  }

  const detailReports = reportsOf(selected);

  if (
    authLoading ||
    !session ||
    profile?.role !== "admin"
  ) {
    return (
      <main className="explorer-shell">
        <div className="state-panel loading-panel">
          <span className="spinner" />
          <p>Verifying administrator access...</p>
        </div>
      </main>
    );
  }

  
return (
    <main className="explorer-shell">
      <aside className="command-sidebar">
        <a href="/" className="sidebar-brand">
          <span className="sidebar-brand-icon">C</span>
          <span>
            <strong>CivicProof</strong>
            <small>CIVIC INTELLIGENCE</small>
          </span>
        </a>

        <div className="sidebar-section-label">WORKSPACE</div>

        <nav className="sidebar-nav">
          <a href="/" className="sidebar-link">
            <span>▦</span> Command Centre
          </a>

          <a href="/reports" className="sidebar-link">
            <span>◎</span> Incident Reports
          </a>

          <a
            href="/clusters"
            className="sidebar-link active"
            aria-current="page"
          >
            <span>◇</span> Incident Clusters
          </a>

          <a href="/investigation" className="sidebar-link">
            <span>⌕</span> AI Investigation
          </a>

          <a href="/briefs" className="sidebar-link">
            <span>▤</span> Action Briefs
          </a>
        </nav>

        <div className="sidebar-bottom">
          <span className="sidebar-bottom-dot" />
          CIVICPROOF OPERATIONS
          <small>Evidence-led civic intelligence</small>
        </div>
      </aside>

      <div className="explorer-wrap">
        <header className="topbar">
          <a
            className="brand"
            href="/"
            aria-label="Back to CivicProof dashboard"
          >
            <span className="brand-mark">
              <Icon name="layers" size={19} />
            </span>

            <span>
              Civic<span className="brand-light">Proof</span>
            </span>
          </a>

          <div className="topbar-right">
            <span className="live-indicator">
              <i />
              Cluster intelligence
            </span>

            <span className="topbar-divider" />

            <span className="operator-label">
              Operations workspace
            </span>
          </div>
        </header>

        <section className="page-heading" id="top">
          <div>
            <div className="eyebrow">
              <span className="eyebrow-line" />
              FIELD INTELLIGENCE
              <span className="eyebrow-dot">/</span>
              CLUSTERS
            </div>

            <h1>Incident Cluster Explorer</h1>

            <p>
              Discover related civic reports through geographic
              proximity and semantic similarity.
            </p>
          </div>

          <button
            className="button button-secondary refresh-button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <Icon name="refresh" size={16} />
            {loading ? "Refreshing" : "Refresh data"}
          </button>
        </section>

        <section
          className="overview-grid"
          aria-label="Cluster overview"
        >
          {(
            [
              ["Total clusters", totals.all, "all"],
              ["Candidates", totals.candidate, "candidate"],
              ["Confirmed", totals.confirmed, "confirmed"],
              ["Dismissed", totals.dismissed, "dismissed"],
            ] as const
          ).map(([label, value, key]) => (
            <article
              className={`metric-card metric-${key}`}
              key={key}
            >
              <div className="metric-label">{label}</div>

              <div className="metric-value">
                {error
                  ? "—"
                  : loading
                    ? "…"
                    : value.toLocaleString()}
              </div>

              <div className="metric-foot">
                <span className={`metric-dot ${key}`} />

                {error
                  ? "API unavailable"
                  : loading
                    ? "Loading API data"
                    : "Current API records"}
              </div>
            </article>
          ))}
        </section>

        <section className="workspace-panel">
          <div className="section-header">
            <div>
              <div className="section-kicker">
                INCIDENT INTELLIGENCE
              </div>

              <h2>
                Cluster registry{" "}
                <span className="result-count">
                  {loading ? "…" : visibleClusters.length}
                </span>
              </h2>
            </div>

            <span className="data-note">
              Candidate groups require human verification
            </span>
          </div>

          <div className="filter-bar">
            <label className="search-field">
              <Icon name="search" size={17} />

              <input
                aria-label="Search clusters"
                placeholder="Search by title or category..."
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
              />
            </label>

            <label className="filter-select">
              <span>Status</span>

              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as StatusFilter)
                }
              >
                <option value="all">All statuses</option>
                <option value="candidate">Candidate</option>
                <option value="confirmed">Confirmed</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </label>

            <label className="filter-select">
              <span>Category</span>

              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value)
                }
              >
                <option value="all">All categories</option>

                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error ? (
            <div className="state-panel error-panel">
              <div className="state-symbol">!</div>

              <h3>Clusters could not be loaded</h3>

              <p>{error}</p>

              <button
                className="button button-secondary"
                onClick={() => void refresh()}
              >
                Try again
              </button>

              <p className="state-hint">
                Confirm the backend is running and set{" "}
                <code>NEXT_PUBLIC_API_BASE_URL</code> if it is not
                at the configured backend API.
              </p>
            </div>
          ) : loading ? (
            <div className="state-panel loading-panel">
              <span className="spinner" />
              <p>Loading cluster data from the API...</p>
            </div>
          ) : clusters.length === 0 ? (
            <div className="state-panel empty-panel">
              <div className="empty-icon">
                <Icon name="layers" size={24} />
              </div>

              <div className="section-kicker">
                NO ACTIVE GROUPS
              </div>

              <h3>No candidate incident clusters yet</h3>

              <p>
                Clusters appear when reports meet the geographic
                and semantic matching criteria. New candidate
                groups remain subject to human review.
              </p>
            </div>
          ) : visibleClusters.length === 0 ? (
            <div className="state-panel filtered-empty">
              <h3>No clusters match these filters</h3>

              <p>
                Try another search term or clear the selected
                filters.
              </p>

              <button
                className="text-button"
                onClick={clearFilters}
              >
                Clear filters
                <Icon name="arrow" size={15} />
              </button>
            </div>
          ) : (
            <div className="cluster-list">
              {visibleClusters.map((cluster) => {
                const reportCount = countOf(cluster);

                return (
                  <article
                    className="cluster-row"
                    key={cluster.id}
                  >
                    <div className="cluster-icon">
                      <Icon name="layers" size={19} />
                    </div>

                    <div className="cluster-main">
                      <div className="cluster-title-line">
                        <h3>{titleOf(cluster)}</h3>

                        <span
                          className={`status-pill ${statusClass(
                            cluster.status
                          )}`}
                        >
                          <i />
                          {displayStatus(cluster.status)}
                        </span>
                      </div>

                      <div className="cluster-meta">
                        <span>
                          {cluster.category || "Uncategorized"}
                        </span>

                        <i />

                        <span>
                          {reportCount}{" "}
                          {reportCount === 1 ? "report" : "reports"}
                        </span>

                        <i />

                        <span>
                          Created {dateOf(cluster.created_at)}
                        </span>
                      </div>
                    </div>

                    <button
                      className="button inspect-button"
                      onClick={() => void openCluster(cluster)}
                      aria-label={`Inspect ${titleOf(cluster)}`}
                    >
                      Inspect
                      <Icon name="arrow" size={15} />
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="action-panel">
          <div className="action-copy">
            <div className="section-kicker">
              MATCHING ENGINE
            </div>

            <h2>Find related reports</h2>

            <p>
              Submit a genuine report ID to find nearby reports
              with similar descriptions. Matching results are
              candidates for operator review.
            </p>
          </div>

          <form
            className="action-form"
            onSubmit={submitClustering}
          >
            <label htmlFor="report-id">Report ID</label>

            <div className="action-input-row">
              <input
                id="report-id"
                value={reportId}
                onChange={(event) =>
                  setReportId(event.target.value)
                }
                placeholder="Paste a report UUID"
                required
              />

              <button
                type="submit"
                className="button button-primary"
                disabled={clusterBusy || !reportId.trim()}
              >
                {clusterBusy ? (
                  <>
                    <span className="button-spinner" />
                    Finding matches
                  </>
                ) : (
                  <>
                    Find matches
                    <Icon name="arrow" size={15} />
                  </>
                )}
              </button>
            </div>

            {actionMessage && (
              <div
                className={`action-message message-${actionMessage.kind}`}
                role="status"
              >
                {actionMessage.text}
              </div>
            )}
          </form>
        </section>

        <footer className="page-footer">
          <span>
            © CivicProof
            <span className="footer-separator">·</span>
            Civic infrastructure intelligence
          </span>

          <span>
            Similarity and distance are algorithmic signals,
            not confirmation of a shared incident.
          </span>
        </footer>
      </div>

      {selected && (
        <div
          className="drawer-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelected(null);
            }
          }}
        >
          <aside
            className="detail-drawer"
            aria-label="Cluster details"
            role="dialog"
            aria-modal="true"
          >
            <div className="drawer-top">
              <div>
                <div className="section-kicker">
                  CLUSTER DETAIL
                </div>

                <span
                  className={`status-pill ${statusClass(
                    selected.status
                  )}`}
                >
                  <i />
                  {displayStatus(selected.status)}
                </span>
              </div>

              <button
                className="icon-button"
                aria-label="Close details"
                onClick={() => setSelected(null)}
              >
                <Icon name="close" />
              </button>
            </div>

            <h2 className="drawer-title">
              {titleOf(selected)}
            </h2>

            <div className="drawer-summary">
              <div>
                <span>Category</span>
                <strong>
                  {selected.category || "Uncategorized"}
                </strong>
              </div>

              <div>
                <span>Reports</span>
                <strong>{countOf(selected)}</strong>
              </div>

              <div>
                <span>Created</span>
                <strong>{dateOf(selected.created_at)}</strong>
              </div>
            </div>

            <div className="report-section-heading">
              <h3>Member reports</h3>
              <span>{detailReports.length} loaded</span>
            </div>

            {detailLoading ? (
              <div className="drawer-loading">
                <span className="spinner" />
                Loading report details...
              </div>
            ) : detailReports.length === 0 ? (
              <div className="drawer-empty">
                No member report details were returned for this
                cluster.
              </div>
            ) : (
              <div className="report-list">
                {detailReports.map((report, index) => {
                  const distance = formatDistance(
                    report.distance_meters
                  );

                  const score = formatScore(
                    report.similarity_score
                  );

                  const coordinates =
                    report.latitude != null &&
                    report.longitude != null
                      ? `${report.latitude.toFixed(
                          5
                        )}, ${report.longitude.toFixed(5)}`
                      : null;

                  return (
                    <article
                      className="report-card"
                      key={report.id ?? `report-${index}`}
                    >
                      <div className="report-card-top">
                        <span className="report-number">
                          REPORT {String(index + 1).padStart(2, "0")}
                        </span>

                        {report.status && (
                          <span className="report-status">
                            {report.status}
                          </span>
                        )}
                      </div>

                      <h4>
                        {report.title || "Untitled report"}
                      </h4>

                      <p>
                        {report.description ||
                          "No description provided."}
                      </p>

                      <div className="report-tags">
                        {report.category && (
                          <span>{report.category}</span>
                        )}

                        {report.severity != null && (
                          <span>
                            Severity {report.severity}
                          </span>
                        )}

                        {report.priority_score != null && (
                          <span>
                            Priority {report.priority_score}
                          </span>
                        )}
                      </div>

                      {(report.location_text || coordinates) && (
                        <div className="report-location">
                          <Icon name="pin" size={15} />

                          <span>
                            {report.location_text || coordinates}

                            {report.location_text && coordinates
                              ? ` · ${coordinates}`
                              : ""}
                          </span>
                        </div>
                      )}

                      {(distance || score) && (
                        <div className="match-signals">
                          {score && (
                            <span>
                              Similarity <strong>{score}</strong>
                            </span>
                          )}

                          {distance && (
                            <span>
                              Distance <strong>{distance}</strong>
                            </span>
                          )}

                          <small>
                            Algorithmic matching signals
                          </small>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            <div className="verification-note">
              <span>!</span>

              <p>
                This is a candidate grouping. Human verification
                is required before treating reports as one
                confirmed incident.
              </p>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
