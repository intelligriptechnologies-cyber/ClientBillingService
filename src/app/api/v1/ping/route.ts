// A bearer-only route that exists so the edge can prove no forwarded identity reaches /api/v1/*.
export function GET(request: Request) {
  return Response.json({ ok: true, remoteUser: request.headers.get('remote-user') });
}
