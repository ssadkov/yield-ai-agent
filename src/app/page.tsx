"use client";

import dynamic from "next/dynamic";
import { AgentHomeSkeleton } from "@/components/agent/AgentHomeSkeleton";

/**
 * Wallet adapters read localStorage / extension state during the first client
 * render. SSR HTML would disagree (Connect vs connected address). Mount the desk
 * only on the client; the skeleton matches on server and hydrate.
 */
const AgentHome = dynamic(
  () => import("@/components/agent/AgentHome").then((mod) => mod.AgentHome),
  { ssr: false, loading: () => <AgentHomeSkeleton /> }
);

export default function Page() {
  return <AgentHome />;
}
