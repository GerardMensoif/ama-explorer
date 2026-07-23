#!/usr/bin/env node

// Serveur de dev local : sert les fichiers statiques et renvoie index.html
// pour les routes directes (/validators, /block/..., /address/...), comme le
// fait le fallback 404 du serveur web en production.
// Usage : node serve.js  (PORT=8090 par défaut)

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 8090;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
};

http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filePath = path.normalize(path.join(ROOT, urlPath));

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(ROOT, 'index.html');
    }

    res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
}).listen(PORT, () => {
    console.log(`Amadeus Explorer : http://localhost:${PORT}`);
});
