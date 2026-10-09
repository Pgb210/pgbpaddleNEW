export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new ApiError(415, "Send booking details as JSON.");
  }
  const body = await request.text();
  if (body.length > 8192) throw new ApiError(413, "Request is too large.");
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new ApiError(400, "Invalid request details.");
  }
}

export function checkOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "Requests must come from this booking site.");
  }
}

export function handleError(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  console.error("Booking service request failed.");
  return json({ error: "Unable to process this request right now. Please try again." }, 500);
}
