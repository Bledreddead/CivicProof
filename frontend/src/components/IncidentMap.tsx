
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

type Incident = {
  id: string;
  title: string;
  description?: string;
  category?: string;
  status?: string;
  severity?: number | null;
  priority_score?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  location_text?: string | null;
  created_at?: string;
};

export default function IncidentMap() {
  const { session, profile, loading: authLoading } = useAuth();

  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hasAutoCentered = useRef(false);

  const [reports, setReports] = useState<Incident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  // Fetch incidents only after verifying the administrator session.
  const loadReports = useCallback(async () => {
    if (!session?.access_token || profile?.role !== "admin") {
      setReports([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/reports`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Unable to load incidents.");
      }

      setReports(data.reports || []);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to connect to backend."
      );
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, profile?.role]);

  useEffect(() => {
    if (authLoading) return;

    if (!session?.access_token || profile?.role !== "admin") {
      setReports([]);
      setLoading(false);
      setError("Administrator access required.");
      return;
    }

    void loadReports();
  }, [authLoading, session?.access_token, profile?.role, loadReports]);

  // Only reports with valid GPS coordinates are mapped.
  const mappedReports = useMemo(() => {
    return reports.filter((report) => {
      const lat = Number(report.latitude);
      const lng = Number(report.longitude);

      return (
        report.latitude !== null &&
        report.latitude !== undefined &&
        report.longitude !== null &&
        report.longitude !== undefined &&
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
      );
    });
  }, [reports]);

  const selectedReport = reports.find(
    (report) => report.id === selectedId
  );

  // Initialize MapLibre and explicitly register its bundled worker.
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    let map: maplibregl.Map;

    try {
      setWorkerUrl(
        new URL(
          "maplibre-gl/dist/maplibre-gl-worker.mjs",
          import.meta.url
        ).toString()
      );

      map = new maplibregl.Map({
        container: mapContainer.current,
        style: MAP_STYLE,
        center: [73.8567, 18.5204],
        zoom: 9,
      });

      mapRef.current = map;

      map.addControl(
        new maplibregl.NavigationControl({
          visualizePitch: true,
        }),
        "top-right"
      );

      // Report map errors instead of leaving an endless loading screen.
      map.on("error", (event) => {
        console.error("MapLibre error:", event.error);
        setError(
          event.error?.message || "A map resource failed to load."
        );
      });

      map.on("load", () => {
        setError("");

        map.addSource("incidents", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 55,
        });

        // Cluster circles.
        map.addLayer({
          id: "incident-clusters",
          type: "circle",
          source: "incidents",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#2563eb",
            "circle-radius": [
              "step",
              ["get", "point_count"],
              19,
              10,
              24,
              30,
              30,
            ],
            "circle-opacity": 0.9,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#93c5fd",
          },
        });

        // Cluster counts.
        map.addLayer({
          id: "incident-cluster-count",
          type: "symbol",
          source: "incidents",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 12,
            "text-font": ["Open Sans Bold"],
          },
          paint: {
            "text-color": "#ffffff",
          },
        });

        // Individual reports coloured by AI-assessed severity.
        map.addLayer({
          id: "incident-points",
          type: "circle",
          source: "incidents",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              6,
              12,
              10,
              16,
              14,
            ],
            "circle-color": [
              "match",
              ["get", "severity"],
              5,
              "#ef4444",
              4,
              "#f97316",
              3,
              "#eab308",
              2,
              "#38bdf8",
              1,
              "#38bdf8",
              "#94a3b8",
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
            "circle-opacity": 0.95,
          },
        });

        // Expand clusters on click.
        map.on(
          "click",
          "incident-clusters",
          async (event: maplibregl.MapLayerMouseEvent) => {
            const features = map.queryRenderedFeatures(event.point, {
              layers: ["incident-clusters"],
            });

            const clusterFeature = features[0];
            const clusterId = clusterFeature?.properties?.cluster_id;

            if (clusterId === undefined || !clusterFeature) return;

            const source = map.getSource(
              "incidents"
            ) as maplibregl.GeoJSONSource;

            try {
              const zoom = await source.getClusterExpansionZoom(
                Number(clusterId)
              );

              if (clusterFeature.geometry.type !== "Point") return;

              const coordinates = clusterFeature.geometry.coordinates as [
                number,
                number
              ];

              map.easeTo({
                center: coordinates,
                zoom,
              });
            } catch (err) {
              console.error("Could not expand cluster:", err);
            }
          }
        );

        // Select an individual incident.
        map.on(
          "click",
          "incident-points",
          (event: maplibregl.MapLayerMouseEvent) => {
            const feature = event.features?.[0];
            const reportId = feature?.properties?.id;

            if (reportId) {
              setSelectedId(String(reportId));
            }
          }
        );

        map.on("mouseenter", "incident-points", () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", "incident-points", () => {
          map.getCanvas().style.cursor = "";
        });

        map.on("mouseenter", "incident-clusters", () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", "incident-clusters", () => {
          map.getCanvas().style.cursor = "";
        });

        setMapLoaded(true);
      });
    } catch (err) {
      console.error("Map initialization failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to initialize the map."
      );
    }

    return () => {
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Update the map whenever real backend reports change.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoaded) return;

    const features = mappedReports.map((report) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [
          Number(report.longitude),
          Number(report.latitude),
        ] as [number, number],
      },
      properties: {
        id: report.id,
        title: report.title || "Untitled incident",
        category: report.category || "other",
        status: report.status || "submitted",
        severity: Number(report.severity) || 0,
        priority_score: Number(report.priority_score) || 0,
        location_text:
          report.location_text || "Location description unavailable",
      },
    }));

    const source = map.getSource(
      "incidents"
    ) as maplibregl.GeoJSONSource | undefined;

    if (source) {
      source.setData({
        type: "FeatureCollection",
        features,
      } as GeoJSON.FeatureCollection);
    }

    // Automatically focus the first real report once.
    if (features.length > 0 && !hasAutoCentered.current) {
      map.flyTo({
        center: features[0].geometry.coordinates,
        zoom: 12,
        duration: 1200,
      });

      hasAutoCentered.current = true;
    }
  }, [mappedReports, mapLoaded]);

  function focusIncident(report: Incident) {
    const map = mapRef.current;

    if (
      !map ||
      report.latitude == null ||
      report.longitude == null
    ) {
      return;
    }

    map.flyTo({
      center: [
        Number(report.longitude),
        Number(report.latitude),
      ],
      zoom: 15,
      duration: 1000,
    });

    setSelectedId(report.id);
  }

  function severityLabel(value: number | null | undefined) {
    if (!value) return "Not assessed";
    if (value >= 4) return "High severity";
    if (value === 3) return "Moderate severity";
    return "Low severity";
  }

  function severityColor(value: number | null | undefined) {
    if (!value) return "text-slate-400";
    if (value >= 4) return "text-red-400";
    if (value === 3) return "text-yellow-400";
    return "text-sky-400";
  }

  return (
    <section className="space-y-5">
      {/* Map heading */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
            GEOSPATIAL INTELLIGENCE
          </p>

          <h2 className="mt-2 text-2xl font-bold text-white">
            Live incident map
          </h2>

          <p className="mt-2 text-sm text-slate-400">
            Geographic view of citizen-reported infrastructure incidents.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadReports()}
          disabled={loading}
          className="rounded-lg border border-white/10 bg-[#111a2b] px-4 py-2.5 text-sm text-slate-300 transition hover:border-blue-400/40 hover:text-white disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "↻ Refresh incidents"}
        </button>
      </div>

      {/* Map statistics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-[#111a2b] p-4">
          <p className="text-xs text-slate-500">Total reports</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {reports.length}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111a2b] p-4">
          <p className="text-xs text-slate-500">Mapped incidents</p>
          <p className="mt-2 text-2xl font-bold text-blue-400">
            {mappedReports.length}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111a2b] p-4">
          <p className="text-xs text-slate-500">High severity</p>
          <p className="mt-2 text-2xl font-bold text-red-400">
            {mappedReports.filter((r) => (r.severity || 0) >= 4).length}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111a2b] p-4">
          <p className="text-xs text-slate-500">Awaiting review</p>
          <p className="mt-2 text-2xl font-bold text-yellow-400">
            {reports.filter((r) => r.status === "submitted").length}
          </p>
        </div>
      </div>

      {/* Interactive map */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#111a2b]">
        <div
          ref={mapContainer}
          className="h-[560px] w-full"
        />

        {!mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d1727]">
            <div className="text-center">
              <p className="text-sm text-slate-300">
                Initializing geospatial intelligence...
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Connecting to map services
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute left-4 right-4 top-4 z-20 rounded-xl border border-red-500/30 bg-[#190e17]/95 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Selected incident details */}
        {selectedReport && (
          <div className="absolute bottom-4 left-4 right-4 z-10 max-w-sm rounded-xl border border-white/15 bg-[#0b1322]/95 p-5 shadow-2xl backdrop-blur-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400">
                  SELECTED INCIDENT
                </p>

                <h3 className="mt-2 text-base font-semibold text-white">
                  {selectedReport.title}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-lg text-slate-400 hover:text-white"
                aria-label="Close incident details"
              >
                ×
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-white/10 px-3 py-1 text-slate-300">
                {selectedReport.category || "Other"}
              </span>

              <span
                className={`rounded-full bg-white/10 px-3 py-1 ${severityColor(
                  selectedReport.severity
                )}`}
              >
                {severityLabel(selectedReport.severity)}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500">Priority score</p>
                <p className="mt-1 font-semibold text-white">
                  {selectedReport.priority_score != null
                    ? Number(selectedReport.priority_score).toFixed(2)
                    : "Not calculated"}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">Status</p>
                <p className="mt-1 font-semibold capitalize text-white">
                  {selectedReport.status || "Unknown"}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                window.location.assign(
                  `/investigation/${selectedReport.id}`
                )
              }
              className="mt-5 w-full rounded-lg bg-blue-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-400"
            >
              Open investigation →
            </button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-white/10 bg-[#111a2b] p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Severity legend
        </p>

        {[
          { color: "bg-sky-400", label: "Low · 1–2" },
          { color: "bg-yellow-400", label: "Moderate · 3" },
          { color: "bg-orange-500", label: "High · 4" },
          { color: "bg-red-500", label: "Critical · 5" },
          { color: "bg-blue-500", label: "Incident cluster" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
            <span className="text-xs text-slate-400">
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {/* Geolocated incident registry */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111a2b]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
          <div>
            <h3 className="font-semibold text-white">
              Geolocated incident registry
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              Select a report to locate it on the map.
            </p>
          </div>

          <p className="text-xs text-slate-500">
            Last refreshed: {lastUpdated || "Not yet refreshed"}
          </p>
        </div>

        {mappedReports.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-400">
              {loading
                ? "Loading reports..."
                : "No reports with valid GPS coordinates are available."}
            </p>

            <p className="mt-2 text-xs text-slate-600">
              Reports without coordinates remain available in the main incident registry.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {mappedReports.map((report) => (
              <button
                type="button"
                key={report.id}
                onClick={() => focusIncident(report)}
                className={`flex w-full flex-wrap items-center justify-between gap-4 p-4 text-left transition hover:bg-white/[0.03] ${
                  selectedId === report.id ? "bg-blue-500/10" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {report.title}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    {(report.category || "other").toUpperCase()} ·{" "}
                    {report.location_text ||
                      "Location description unavailable"}
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <span
                    className={`text-xs font-medium ${severityColor(
                      report.severity
                    )}`}
                  >
                    {severityLabel(report.severity)}
                  </span>

                  <span className="text-xs text-slate-500">
                    {report.priority_score != null
                      ? Number(report.priority_score).toFixed(1)
                      : "—"}
                  </span>

                  <span className="text-blue-400">→</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs leading-5 text-slate-600">
        Map markers represent submitted report coordinates. Severity colours
        reflect recorded AI assessments, not independently verified field
        conditions. Map tiles are provided by OpenFreeMap.
      </p>
    </section>
  );
}
