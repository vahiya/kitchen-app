const express = require('express');
const { MongoClient } = require('mongodb');
const client = require('prom-client');

const app = express();
app.use(express.json());
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({ name: 'http_requests_total', help: 'Total number of HTTP requests', labelNames: ['method', 'route', 'status_code'], registers: [register] });
const httpRequestDurationSeconds = new client.Histogram({ name: 'http_request_duration_seconds', help: 'HTTP request duration in seconds', labelNames: ['method', 'route', 'status_code'], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [register] });
const kitchenOrdersCreatedTotal = new client.Counter({ name: 'kitchen_orders_created_total', help: 'Total number of kitchen orders created', registers: [register] });

let ordersCollection = null;
let orderStatusWorkerStarted = false;
const ENABLE_ORDER_SIMULATION = process.env.ENABLE_ORDER_SIMULATION !== 'false' && process.env.NODE_ENV !== 'test';
const ORDER_STATUS_FLOW = { pending: { next: 'preparing', afterMs: 5000 }, preparing: { next: 'ready', afterMs: 5000 }, ready: { next: 'served', afterMs: 5000 } };

function startOrderStatusWorker() {
  if (!ENABLE_ORDER_SIMULATION || orderStatusWorkerStarted || !ordersCollection) return;
  orderStatusWorkerStarted = true;
  const interval = setInterval(async () => {
    try {
      const now = new Date();
      const unscheduled = await ordersCollection.find({ status: { $in: Object.keys(ORDER_STATUS_FLOW) }, $or: [{ nextStatus: { $exists: false } }, { nextStatusAt: { $exists: false } }] }).limit(25).toArray();
      for (const order of unscheduled) {
        const flow = ORDER_STATUS_FLOW[order?.status];
        if (!flow) continue;
        await ordersCollection.updateOne({ _id: order._id, status: order.status, nextStatus: { $exists: false } }, { $set: { nextStatus: flow.next, nextStatusAt: new Date(now.getTime() + flow.afterMs) } });
      }
      const due = await ordersCollection.find({ nextStatusAt: { $lte: now }, nextStatus: { $type: 'string' } }).limit(25).toArray();
      for (const order of due) {
        const newStatus = order?.nextStatus;
        if (!newStatus) continue;
        const next = ORDER_STATUS_FLOW[newStatus];
        const update = next ? { $set: { status: newStatus, statusUpdatedAt: now, nextStatus: next.next, nextStatusAt: new Date(now.getTime() + next.afterMs) } } : { $set: { status: newStatus, statusUpdatedAt: now }, $unset: { nextStatus: '', nextStatusAt: '' } };
        await ordersCollection.updateOne({ _id: order._id }, update);
      }
    } catch (e) { console.error('Order simulation worker error:', e.message); }
  }, 1000);
  if (typeof interval.unref === 'function') interval.unref();
}

function normalizeRoute(path) {
  if (path === '/metrics' || path === '/health' || path === '/ready') return path;
  if (path === '/orders' || path.startsWith('/orders')) return '/orders';
  return path;
}
app.use((req, res, next) => {
  const start = Date.now();
  const route = normalizeRoute(req.route?.path || req.path);
  res.on('finish', () => {
    const status = String(res.statusCode);
    const duration = (Date.now() - start) / 1000;
    httpRequestsTotal.inc({ method: req.method, route, status_code: status });
    httpRequestDurationSeconds.observe({ method: req.method, route, status_code: status }, duration);
  });
  next();
});

async function connectDb() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
  try { const mongo = await MongoClient.connect(uri); ordersCollection = mongo.db('kitchen').collection('orders'); startOrderStatusWorker(); return true; }
  catch { return false; }
}

app.get('/health', (req, res) => res.json({ status: 'ok', db: ordersCollection ? 'connected' : 'disconnected' }));
app.get('/ready', (req, res) => res.status(200).send('OK'));
app.get('/metrics', async (req, res) => { res.set('Content-Type', register.contentType); res.end(await register.metrics()); });
app.get('/orders', async (req, res) => { if (!ordersCollection) return res.status(503).json({ error: 'Database not connected' }); const orders = await ordersCollection.find({}).toArray(); res.json(orders); });
app.post('/orders', async (req, res) => {
  if (!ordersCollection) return res.status(503).json({ error: 'Database not connected' });
  const dish = req.body?.dish; if (!dish) return res.status(400).json({ error: 'Missing dish' });
  const now = new Date(); const doc = { dish, status: 'pending', createdAt: now, statusUpdatedAt: now };
  if (ENABLE_ORDER_SIMULATION) { doc.nextStatus = ORDER_STATUS_FLOW.pending.next; doc.nextStatusAt = new Date(now.getTime() + ORDER_STATUS_FLOW.pending.afterMs); }
  const result = await ordersCollection.insertOne(doc); kitchenOrdersCreatedTotal.inc(); res.status(201).json({ _id: result.insertedId, ...doc });
});

const PORT = Number(process.env.PORT) || 3000;
async function start() { await connectDb(); app.listen(PORT, () => console.log(`Kitchen API listening on port ${PORT}`)); }
if (require.main === module) start().catch(console.error);
module.exports = app; module.exports.connectDb = connectDb;