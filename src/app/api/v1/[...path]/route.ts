import { forwardBackendRequest } from "@/modules/drone-defense/infra/backend-proxy";
export const dynamic = "force-dynamic";
function forward(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.slice(url.pathname.indexOf("/api/v1") + 7).replace(/\/+$/, "") || "/";
  return forwardBackendRequest(path + url.search, {}, { request });
}
export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE, forward as HEAD, forward as OPTIONS };
