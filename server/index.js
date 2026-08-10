/* eslint-disable no-undef */
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { handleSummarize, handleChat } from './gemini.js';
import { handleNvidiaSummarize, handleNvidiaChat } from './nvidia.js';

const root = join(process.cwd(), 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webm': 'video/webm' };

createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/api/chat/nvidia') return handleNvidiaChat(request, response);
    if (url.pathname === '/api/chat') return handleChat(request, response);
    if (url.pathname === '/api/summarize/nvidia') return handleNvidiaSummarize(request, response);
    if (url.pathname === '/api/summarize') return handleSummarize(request, response);

    const requested = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
    const isFileWithinRoot = requested.startsWith(root) && existsSync(requested);

    if (isFileWithinRoot) {
        response.writeHead(200, { 'Content-Type': mime[extname(requested)] || 'application/octet-stream' });
        return createReadStream(requested).pipe(response);
    }

    // For missing asset/model files or path extensions, return 404 instead of index.html
    if (extname(url.pathname) || url.pathname.startsWith('/models/') || url.pathname.startsWith('/assets/')) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        return response.end(JSON.stringify({ error: 'Asset not found' }));
    }

    const fallback = join(root, 'index.html');
    if (existsSync(fallback)) {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        return createReadStream(fallback).pipe(response);
    }

    response.writeHead(404);
    response.end('Not found');
}).listen(process.env.PORT || 4173, () => console.log(`Meetwise is ready on http://localhost:${process.env.PORT || 4173}`));

