import type {
  ClusterReport,
  ClusterListResponse,
  ClusterRequestResponse,
  IncidentCluster,
} from "@/types/cluster";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

async function request<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new Error(
      `Could not reach the CivicProof API at ${API_BASE_URL}. Check that the backend is running and the API URL is correct.`,
    );
  }

  const text = await response.text();
  let data: unknown;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : typeof data === "object" && data !== null && "message" in data
          ? String((data as { message: unknown }).message)
          : `Request failed with status ${response.status}`;

    throw new Error(detail);
  }

  return data as T;
}

function extractClusterList(
  data: ClusterListResponse | IncidentCluster[],
): IncidentCluster[] {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.clusters) ? data.clusters : [];
}

export async function getClusters(
  accessToken: string,
): Promise<IncidentCluster[]> {
  const data = await request<ClusterListResponse | IncidentCluster[]>(
    "/clusters",
    accessToken,
  );

  return extractClusterList(data);
}

export async function getCluster(
  clusterId: string,
  accessToken: string,
): Promise<IncidentCluster> {
  const data = await request<Record<string, unknown>>(
    `/clusters/${encodeURIComponent(clusterId)}`,
    accessToken,
  );

  if (typeof data.cluster === "object" && data.cluster !== null) {
    const cluster = data.cluster as IncidentCluster;

    return {
      ...cluster,
      reports: Array.isArray(data.reports)
        ? (data.reports as ClusterReport[])
        : cluster.reports,
      members: Array.isArray(data.members)
        ? (data.members as IncidentCluster["members"])
        : cluster.members,
    };
  }

  return data as IncidentCluster;
}

export async function requestClustering(
  reportId: string,
  accessToken: string,
  options: { radiusMeters?: number; similarityThreshold?: number } = {},
): Promise<ClusterRequestResponse> {
  const query = new URLSearchParams();

  if (options.radiusMeters !== undefined) {
    query.set("radius_meters", String(options.radiusMeters));
  }

  if (options.similarityThreshold !== undefined) {
    query.set("similarity_threshold", String(options.similarityThreshold));
  }

  const suffix = query.size ? `?${query.toString()}` : "";

  return request<ClusterRequestResponse>(
    `/reports/${encodeURIComponent(reportId)}/cluster${suffix}`,
    accessToken,
    { method: "POST" },
  );
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}