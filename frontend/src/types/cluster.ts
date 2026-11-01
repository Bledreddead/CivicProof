/** Values returned by the CivicProof cluster API. */
export type ClusterStatus = "candidate" | "confirmed" | "dismissed" | (string & {});

/** A report attached to an incident cluster. API fields may be absent or null. */
export interface ClusterReport {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  asset_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_text?: string | null;
  severity?: string | number | null;
  priority_score?: number | null;
  status?: string | null;
  created_at?: string | null;
  similarity_score?: number | null;
  distance_meters?: number | null;
}

/** A cluster in the list response or the detail response. */
export interface IncidentCluster {
  id: string;
  title?: string | null;
  category?: string | null;
  status?: ClusterStatus | null;
  created_at?: string | null;
  member_count?: number | null;
  report_count?: number | null;
  reports?: ClusterReport[] | null;
  members?: Array<{
    report?: ClusterReport | null;
    report_id?: string | null;
    similarity_score?: number | null;
    distance_meters?: number | null;
    added_at?: string | null;
    [key: string]: unknown;
  }> | null;
  [key: string]: unknown;
}

export interface ClusterListResponse {
  status?: string;
  count?: number;
  clusters?: IncidentCluster[];
}

/** The clustering endpoint response is intentionally open-ended. */
export type ClusterRequestResponse = Record<string, unknown>;
