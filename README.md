# Webhook Proxy para StubHub

Servicio proxy que recibe webhooks de StubHub y los reenvía a:
1. **Producción** (`inventory.ticketits.com`)
2. **Desarrollo** (endpoints registrados dinámicamente)

## Deploy en Render

### Opción 1: Blueprint (Automático)
1. Conectar repo a Render
2. El archivo `render.yaml` configura todo automáticamente

### Opción 2: Manual
1. Crear nuevo "Web Service" en Render
2. Conectar este repositorio
3. Configurar:
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Environment:** Node
   - **Plan:** Free

### Variables de Entorno
| Variable | Valor |
|----------|-------|
| `PRODUCTION_URL` | `https://inventory.ticketits.com/api/webhooks/stubhub` |

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/webhooks/stubhub` | Recibe webhooks de StubHub |
| POST | `/dev/register` | Registrar endpoint de desarrollo |
| GET | `/dev/list` | Listar endpoints de desarrollo |

## Uso

### Registrar endpoint de desarrollo
```bash
curl -X POST https://webhook-proxy-xxx.onrender.com/dev/register \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tu-tunel.ngrok.io/api/webhooks/stubhub", "action": "add"}'
```

### Eliminar endpoint de desarrollo
```bash
curl -X POST https://webhook-proxy-xxx.onrender.com/dev/register \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tu-tunel.ngrok.io/api/webhooks/stubhub", "action": "remove"}'
```

## Configurar en StubHub

Una vez deployado, actualizar el webhook en StubHub para apuntar a:
```
https://webhook-proxy-xxx.onrender.com/api/webhooks/stubhub
```
