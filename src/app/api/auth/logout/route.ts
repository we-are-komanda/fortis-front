import { authCookie } from "@/shared/server/auth-cookie";
export async function POST() {
  return Response.json(
    { status: "ok" },
    {
      headers: {
        "Set-Cookie": authCookie("", 0),
        "cache-control": "no-store",
      },
    },
  );
}
