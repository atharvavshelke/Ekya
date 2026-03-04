import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RelayServer } from '../server/RelayServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const PORT = parseInt(process.env.PORT || '4444');

// ─── HTTP Static Server ─────────────────────────────────────
const httpServer = http.createServer((req, res) => {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);

    // Security: prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error');
            }
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

// ─── Attach Relay Server ────────────────────────────────────
const relay = new RelayServer({ server: httpServer, verbose: true });

httpServer.listen(PORT, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════════╗');
    console.log('  ║                                           ║');
    console.log('  ║   🔐 Ekya E2EE Collaborative Demo        ║');
    console.log('  ║                                           ║');
    console.log(`  ║   Demo:   http://localhost:${PORT}            ║`);
    console.log(`  ║   Relay:  ws://localhost:${PORT}              ║`);
    console.log('  ║                                           ║');
    console.log('  ║   Open in 2 tabs to see collaboration!    ║');
    console.log('  ║                                           ║');
    console.log('  ╚═══════════════════════════════════════════╝');
    console.log('');
});
