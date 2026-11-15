export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) return new Response('Missing URL', { status: 400 });

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`NASA responded with ${response.status}`);
    
    // Stream the raw FITS file directly to the browser
    return new Response(response.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}