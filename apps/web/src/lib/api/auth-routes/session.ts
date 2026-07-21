import { getUserBySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET() {
  const jar = await cookies();
  const user = getUserBySessionToken(jar.get(SESSION_COOKIE)?.value);
  return Response.json(
    { authenticated: Boolean(user), user },
    { headers: { "Cache-Control": "no-store" } },
  );
}
