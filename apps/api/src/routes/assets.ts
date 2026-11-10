import { Router } from 'express';

const router = Router();

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[character]!);
}

router.get('/category/:slug.svg', (req, res) => {
  const label = escapeXml(req.params.slug.replace(/-/g, ' ').toUpperCase());
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400" role="img" aria-label="${label} category illustration">
      <rect width="600" height="400" fill="#F7F5F2"/>
      <rect x="36" y="36" width="528" height="328" rx="18" fill="#fff" stroke="#ECEAE7" stroke-width="2"/>
      <path d="M92 250c48-72 92-104 144-104s96 32 144 104" fill="none" stroke="#D71920" stroke-width="12" stroke-linecap="round"/>
      <path d="M164 252h272" stroke="#171717" stroke-width="8" stroke-linecap="round"/>
      <circle cx="204" cy="210" r="22" fill="#F2B544"/>
      <circle cx="306" cy="188" r="28" fill="#ECEAE7"/>
      <circle cx="390" cy="216" r="18" fill="#D71920" fill-opacity=".72"/>
      <text x="300" y="315" fill="#171717" font-size="24" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700">${label}</text>
    </svg>`;
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').send(svg);
});

router.get('/product/placeholder.svg', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" role="img" aria-label="Product image not available">
      <rect width="600" height="600" fill="#F7F5F2"/>
      <rect x="70" y="70" width="460" height="460" rx="18" fill="#fff" stroke="#ECEAE7" stroke-width="2"/>
      <rect x="205" y="165" width="190" height="180" rx="12" fill="#F7F5F2"/>
      <path d="M245 290l48-62 32 39 22-25 34 48H245z" fill="#D71920" fill-opacity=".72"/>
      <circle cx="330" cy="205" r="17" fill="#F2B544"/>
      <text x="300" y="402" fill="#171717" font-size="23" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700">IMAGE NEEDED</text>
      <text x="300" y="438" fill="#666" font-size="15" text-anchor="middle" font-family="Arial,sans-serif">Approved product photography not yet available</text>
    </svg>`);
});

router.get('/product/:slug.svg', (req, res) => {
  const label = escapeXml(req.params.slug.replace(/-/g, ' ').toUpperCase());
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" role="img" aria-label="${label}; demonstration placeholder">
      <rect width="600" height="600" fill="#F7F5F2"/>
      <rect x="70" y="70" width="460" height="460" rx="18" fill="#fff" stroke="#ECEAE7" stroke-width="2"/>
      <rect x="205" y="150" width="190" height="180" rx="12" fill="#F7F5F2"/>
      <path d="M245 276l48-62 32 39 22-25 34 48H245z" fill="#D71920" fill-opacity=".72"/>
      <circle cx="330" cy="190" r="17" fill="#F2B544"/>
      <text x="300" y="390" fill="#171717" font-size="18" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700">${label}</text>
      <text x="300" y="430" fill="#D71920" font-size="15" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700">IMAGE NEEDED</text>
      <text x="300" y="460" fill="#666" font-size="13" text-anchor="middle" font-family="Arial,sans-serif">Neutral demo placeholder only</text>
    </svg>`;
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').send(svg);
});

export default router;
