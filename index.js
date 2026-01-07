const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3080;
const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://inventory.ticketits.com/api/webhooks/stubhub';

// En memoria (Render free tier no tiene volúmenes persistentes)
let devEndpoints = [];

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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      service: 'webhook-proxy',
      production: PRODUCTION_URL,
      devEndpoints: devEndpoints.length,
      timestamp: new Date().toISOString() 
    }));
    return;
  }
  
  // Registrar/eliminar dev endpoints
  if (req.url === '/dev/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { url, action } = JSON.parse(body);
        
        if (action === 'add' && !devEndpoints.includes(url)) {
          devEndpoints.push(url);
          console.log(`📝 [DEV] Endpoint registrado: ${url}`);
        } else if (action === 'remove') {
          devEndpoints = devEndpoints.filter(e => e !== url);
          console.log(`🗑️ [DEV] Endpoint eliminado: ${url}`);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, endpoints: devEndpoints }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // Listar dev endpoints
  if (req.url === '/dev/list' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ endpoints: devEndpoints }));
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
      await forwardWebhook(PRODUCTION_URL, forwardHeaders, body, 'PROD');
      
      // Reenviar a endpoints de desarrollo
      if (devEndpoints.length > 0) {
        console.log(`  📤 Forwarding to ${devEndpoints.length} dev endpoint(s)...`);
        for (const devUrl of devEndpoints) {
          await forwardWebhook(devUrl, forwardHeaders, body, 'DEV');
        }
      }
      
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
