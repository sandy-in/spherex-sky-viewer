export async function GET(request, { params }) {
  const { task_id } = await params; 
  const backendUrl = process.env.NEXT_PUBLIC_PYTHON_URL || 'http://127.0.0.1:8000';

  try {
    const pythonUrl = `${backendUrl}/api/status/${task_id}`;
    const response = await fetch(pythonUrl);
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: "Python backend is not running." }, { status: 500 });
  }
}