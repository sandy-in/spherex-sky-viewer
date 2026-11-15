export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ra = searchParams.get('ra');
  const dec = searchParams.get('dec');
  const fov = searchParams.get('fov');

  if (!ra || !dec) {
    return Response.json({ error: 'Missing coordinates' }, { status: 400 });
  }

  try {
    const nasaUrl = `https://irsa.ipac.caltech.edu/SIA?POS=circle+${ra}+${dec}+${fov}&COLLECTION=spherex_qr3`;
    
    const response = await fetch(nasaUrl);
    const xmlText = await response.text();

    const urlRegex = /(https?:\/\/[^\s<"]+)/g;
    const allUrls = xmlText.match(urlRegex) || [];
    
    const urls = [...new Set(allUrls
      .map(u => u.replace(/&amp;/g, '&'))
      .filter(u => u.includes('.fits') || u.includes('/ibe/data/'))
    )].map(fitsUrl => {
      // Use the correct angular size format and request an uncompressed file
      return `${fitsUrl}?center=${ra},${dec}&size=0.1&gzip=false`;
    });

    return Response.json({ 
      success: true, 
      count: urls.length, 
      urls: urls.slice(0, 1),
      debug: "Cutout URLs generated with angular size and gzip=false"
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}