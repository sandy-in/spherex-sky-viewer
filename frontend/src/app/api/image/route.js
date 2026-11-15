export const maxDuration = 60;

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const ra = searchParams.get('ra');
  const dec = searchParams.get('dec');
  const fov = searchParams.get('fov');
  const start_date = searchParams.get('start_date') || '';
  const end_date = searchParams.get('end_date') || '';
  const band = searchParams.get('band') || '';
  const max_frames = searchParams.get('max_frames') || '2';
  const fps = searchParams.get('fps') || '1';
  const offset = searchParams.get('offset') || '0';

  const backendUrl = process.env.NEXT_PUBLIC_PYTHON_URL || 'http://127.0.0.1:8000';

  try {
    const pythonUrl = `${backendUrl}/api/image?ra=${ra}&dec=${dec}&fov=${fov}&start_date=${start_date}&end_date=${end_date}&band=${band}&max_frames=${max_frames}&fps=${fps}&offset=${offset}`;
    const response = await fetch(pythonUrl, { method: 'POST' });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: "Python backend is not running." }, { status: 500 });
  }
}