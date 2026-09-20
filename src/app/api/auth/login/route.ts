import { backendErrorResponse, forwardBackendRequest, readBackendJson, boundaryError } from "@/modules/drone-defense/infra/backend-proxy";

import { authCookie } from "@/shared/server/auth-cookie";

type AuthResponse = {
  token?: string;
  user?: unknown;
};

export async function POST(request: Request) {
  const body = await request.text();
  try {
    const response = await forwardBackendRequest("/auth/login", { method: "POST", body, headers: { "content-type": "application/json" } });
    const data = (await readBackendJson(response)) as AuthResponse;
    if (!data || typeof data.token !== "string" || !data.token) {
      return boundaryError(502, "protocol_error", "Backend did not return an access token", response.headers.get("x-request-id") ?? undefined);
    }
    return Response.json(
      { user: data.user },
      {
        headers: {
          "Set-Cookie": authCookie(data.token),
          "cache-control": "no-store",
          "x-request-id": response.headers.get("x-request-id")!,
        },
      },
    );
  } catch (err) {
    return backendErrorResponse(err);
  }
}
