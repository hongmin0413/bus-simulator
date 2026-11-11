// 本機靜態檔案伺服器（不需額外套件）
//   http://localhost:8765      電腦上玩
//   https://<電腦IP>:8766      手機上玩（旋轉手機轉向需要 HTTPS；憑證為自簽，第一次開會有警告）
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const HTTP_PORT = Number(process.env.PORT) || 8765;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8766;
const CERT_DIR = path.join(ROOT, '.cert');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

function handler(req, res) {
  let rel;
  try { rel = decodeURIComponent(req.url.split('?')[0]); } catch { rel = '/'; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  // 只提供專案目錄內、且不是以 . 開頭的檔案（.cert、.agents、.git 不對外）
  const inside = file.startsWith(ROOT + path.sep) && !path.relative(ROOT, file).split(path.sep).some((p) => p.startsWith('.'));
  if (!inside) { res.writeHead(403); res.end('403'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 找不到檔案'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// 產生自簽憑證（用 Git for Windows 內附的 openssl）；IP 變了就重新產生
function ensureCert(ips) {
  const key = path.join(CERT_DIR, 'key.pem'), cert = path.join(CERT_DIR, 'cert.pem'), stamp = path.join(CERT_DIR, 'ips.txt');
  const want = ips.join(',');
  if (fs.existsSync(key) && fs.existsSync(cert) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === want) return { key, cert };
  const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => 'IP:' + ip)].join(',');
  fs.mkdirSync(CERT_DIR, { recursive: true });
  for (const exe of candidates) {
    try {
      execFileSync(exe, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-keyout', key, '-out', cert,
        '-subj', '/CN=bus-simulator', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
      fs.writeFileSync(stamp, want);
      return { key, cert };
    } catch { /* 換下一個 openssl */ }
  }
  return null;
}

const ips = lanAddresses();
http.createServer(handler).listen(HTTP_PORT, () => {
  console.log('');
  console.log('  手排公車模擬器 已啟動（關閉此視窗即停止）');
  console.log('');
  console.log('  電腦：http://localhost:' + HTTP_PORT + '/');
});

const pem = ensureCert(ips);
if (pem) {
  https.createServer({ key: fs.readFileSync(pem.key), cert: fs.readFileSync(pem.cert) }, handler).listen(HTTPS_PORT, () => {
    for (const ip of ips) console.log('  手機：https://' + ip + ':' + HTTPS_PORT + '/   （手機與電腦要在同一個網路）');
    if (!ips.length) console.log('  手機：電腦目前沒有連上區域網路，無法提供手機網址');
    console.log('');
    console.log('  手機第一次開啟會出現「連線不是私人連線」的警告，按「進階」→「繼續前往」即可。');
    console.log('  Windows 若詢問防火牆，請按「允許」。');
    console.log('');
  });
} else {
  console.log('  找不到 openssl，無法啟動 HTTPS，手機將不能用旋轉轉向（需安裝 Git for Windows）。');
}