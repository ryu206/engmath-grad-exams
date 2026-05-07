export function GET() {
  return Response.json({
    ok: true,
    service: 'engineering-math-bank',
    timestamp: new Date().toISOString(),
  });
}
