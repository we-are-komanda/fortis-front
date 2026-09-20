import { forwardBackendRequest } from "@/modules/drone-defense/infra/backend-proxy";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return forwardBackendRequest("/auth/me", {}, { request });
}
