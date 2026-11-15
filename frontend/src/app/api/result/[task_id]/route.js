export async function GET(request, { params }) {
  const { task_id } = await params;
  const backendUrl = process.env.NEXT_PUBLIC_PYTHON_URL || 'http://127.0.0.1:8000';

  try {
    const pythonUrl = `${backendUrl}/api/result/${task_id}`;
    const response = await fetch(pythonUrl);
    
    if (!response.ok) {
      return new Response("Result not ready", { status: response.status });
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    return new Response("Python backend is not running.", { status: 500 });
  }
}