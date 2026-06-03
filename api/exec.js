const GSCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxPPb7y-mew7vsXBJ2KmRBQWG57rx8nGgyd7CvqiFXJ5HCbhLidrqcD46pUC4m4XLBRsg/exec';

export default async function handler(req, res) {
  // Build the GScript URL with all query params
  const params = new URLSearchParams(req.query);
  const url = `${GSCRIPT_URL}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Vercel)',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `GScript returned ${response.status}`
      });
    }

    const data = await response.json();

    // Set CORS headers for browser access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'application/json');
    // Cache for 5 minutes on CDN
    res.setHeader('Cache-Control', 's-maxage=300');

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'Proxy error'
    });
  }
}
