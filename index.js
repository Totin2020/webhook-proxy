const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3080;
const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://inventory.ticketits.com/api/webhooks/stubhub';
const DEV_SECRET = process.env.DEV_SECRET || 'ticketits-dev-2025';

// Cola de webhooks para desarrollo (máximo 100, expiran en 5 minutos)
let webhookQueue = [];
const MAX_QUEUE_SIZE = 100;
const WEBHOOK_TTL = 5 * 60 * 1000; // 5 minutos

// Limpiar webhooks expirados
function cleanExpiredWebhooks() {
  const now = Date.now();
  webhookQueue = webhookQueue.filter(w => (now - w.timestamp) < WEBHOOK_TTL);
}

// Agregar webhook a la cola
function queueWebhook(headers, body, topic, deliveryId) {
  cleanExpiredWebhooks();
  
  if (webhookQueue.length >= MAX_QUEUE_SIZE) {
    webhookQueue.shift(); // Eliminar el más viejo
  }
  
  webhookQueue.push({
    id: deliveryId,
    topic,
    headers,
    body,
    timestamp: Date.now()
  });
}

// Obtener webhooks pendientes y limpiar cola
function getAndClearWebhooks() {
  cleanExpiredWebhooks();
  const webhooks = [...webhookQueue];
  webhookQueue = [];
  return webhooks;
}

function forwardWebhook(targetUrl, headers, body, label) {
  return new Promise((resolve) => {
    const url = new URL(targetUrl);
    const protocol = url.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        ...headers,
        'host': url.hostname,
        'content-length': Buffer.byteLength(body)
      },
      timeout: 10000
    };
    
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`  ✅ [${label}] ${res.statusCode} - ${targetUrl}`);
        resolve({ success: true, status: res.statusCode });
      });
    });
    
    req.on('error', (e) => {
      console.log(`  ❌ [${label}] Error: ${e.message}`);
      resolve({ success: false, error: e.message });
    });
    
    req.on('timeout', () => {
      console.log(`  ⏱️ [${label}] Timeout`);
      req.destroy();
      resolve({ success: false, error: 'timeout' });
    });
    
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health' || req.url === '/') {
    cleanExpiredWebhooks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      service: 'webhook-proxy',
      production: PRODUCTION_URL,
      queueSize: webhookQueue.length,
      timestamp: new Date().toISOString() 
    }));
    return;
  }
  
  // POLLING: Obtener webhooks pendientes (para desarrollo local)
  if (req.url === '/dev/poll' && req.method === 'GET') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    
    if (token !== DEV_SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    const webhooks = getAndClearWebhooks();
    console.log(`📥 [POLL] Devolviendo ${webhooks.length} webhook(s) pendientes`);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ webhooks }));
    return;
  }
  
  // Ver estado de la cola (sin autenticación, solo info)
  if (req.url === '/dev/status' && req.method === 'GET') {
    cleanExpiredWebhooks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      queueSize: webhookQueue.length,
      maxSize: MAX_QUEUE_SIZE,
      ttlMinutes: WEBHOOK_TTL / 60000
    }));
    return;
  }
  
  // Webhook receiver de StubHub
  if (req.url === '/api/webhooks/stubhub' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const topic = req.headers['vgg-topic'] || 'unknown';
      const deliveryId = req.headers['vgg-deliveryid'] || 'unknown';
      
      console.log(`\n🔔 [WEBHOOK] Received from StubHub`);
      console.log(`  - Topic: ${topic}`);
      console.log(`  - DeliveryId: ${deliveryId}`);
      console.log(`  - Size: ${body.length} bytes`);
      console.log(`  - Time: ${new Date().toISOString()}`);
      console.log(`  - Headers received:`, JSON.stringify(req.headers, null, 2));
      
      // Responder inmediatamente a StubHub (debe ser < 10 segundos)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true, deliveryId }));
      
      // Headers a reenviar
      const forwardHeaders = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (!['host', 'content-length', 'connection'].includes(key.toLowerCase())) {
          forwardHeaders[key] = value;
        }
      }
      
      // Reenviar a producción
      console.log('  📤 Forwarding to production...');
      console.log(`  - Headers to forward:`, JSON.stringify(forwardHeaders, null, 2));
      await forwardWebhook(PRODUCTION_URL, forwardHeaders, body, 'PROD');
      
      // Guardar en cola para polling de desarrollo
      queueWebhook(forwardHeaders, body, topic, deliveryId);
      console.log(`  📦 Queued for dev polling (${webhookQueue.length} in queue)`);
      
      console.log('  ✅ Done\n');
    });
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Webhook Proxy running on port ${PORT}`);
  console.log(`   Production: ${PRODUCTION_URL}`);
  console.log(`\n   Endpoints:`);
  console.log(`   - POST /api/webhooks/stubhub (webhook receiver)`);
  console.log(`   - POST /dev/register (add/remove dev endpoints)`);
  console.log(`   - GET  /dev/list (list dev endpoints)`);
  console.log(`   - GET  /health (health check)\n`);
});
