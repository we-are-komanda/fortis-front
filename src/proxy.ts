import { NextResponse, type NextRequest } from "next/server";

const protectedRoutes = ["/prototype", "/calculator", "/workspace"];
import { forwardBackendRequest, readBackendJson, backendErrorResponse, boundaryError } from "@/modules/drone-defense/infra/backend-proxy";
import { getRuntimeMode } from "@/shared/server/runtime-config";

function isProtectedPath(pathname: string) {
  return protectedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export async function proxy(request: NextRequest) {
  if (!isProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // Explicit demo remains a separate runtime; workspace always needs a real identity.
  try { if (getRuntimeMode() === "demo") return NextResponse.next(); } catch { return boundaryError(503, "configuration_error", "Runtime configuration is unavailable"); }
  const token = request.cookies.get("access-token")?.value;
  if (token) {
    const response = await forwardBackendRequest("/auth/me", { method: "GET" }, { request });
    if (response.status !== 401) {
      try {
        const user = await readBackendJson(response) as { id?: unknown };
        if (typeof user?.id !== "string" || !user.id) return boundaryError(502, "protocol_error", "Identity response is invalid");
        return NextResponse.next();
      } catch (error) { return backendErrorResponse(error); }
    }
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/prototype/:path*", "/calculator/:path*", "/workspace/:path*"],
};
