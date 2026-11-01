
import ClusterExplorer from "@/components/clusters/ClusterExplorer";

export const metadata = {
  title: "Incident Cluster Explorer | CivicProof",
  description:
    "Review candidate civic incidents grouped by geographic proximity and semantic similarity.",
};

export default function ClustersPage() {
  return <ClusterExplorer />;
}
