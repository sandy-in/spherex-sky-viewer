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
    
    // Generate FITS cutout URLs (no JPEG conversion)
    const fitsUrls = [...new Set(allUrls
      .map(u => u.replace(/&amp;/g, '&'))
      .filter(u => u.includes('.fits') || u.includes('/ibe/data/'))
    )].map(fitsUrl => {
      const cutoutBase = fitsUrl.replace('/data/', '/cutout/');
      return `${cutoutBase}?center=${ra},${dec}&size=${fov}`;
    });

    return Response.json({ 
      success: true, 
      count: fitsUrls.length, 
      urls: fitsUrls.slice(0, 9),
      debug: "FITS cutout URLs generated!"
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}