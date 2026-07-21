import { createRoot } from 'react-dom/client';

import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';

import './index.css';

// In the default single-origin deployment (frontend + API behind one
// reverse proxy, e.g. Replit) VITE_API_URL is left unset and relative
// "/api/..." calls stay same-origin. When the frontend is split onto its
// own host (e.g. Vercel) with the API elsewhere (e.g. Railway/Replit),
// set VITE_API_URL to the API's full origin at build time and every
// relative request gets that prefix instead.
const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
setBaseUrl(apiUrl && apiUrl.length > 0 ? apiUrl : null);

createRoot(document.getElementById('root')!).render(<App />);
