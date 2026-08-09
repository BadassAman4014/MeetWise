/* eslint-disable no-undef */
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { handleSummarize } from './gemini.js';

const root = join(process.cwd(), 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webm': 'video/webm' };

createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/api/summarize') return handleSummarize(request, response);
    const requested = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
    const file = requested.startsWith(root) && existsSync(requested) ? requested : join(root, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(response);
}).listen(process.env.PORT || 4173, () => console.log(`Meetwise is ready on http://localhost:${process.env.PORT || 4173}`));
