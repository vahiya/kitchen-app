const request = require('supertest');
jest.mock('mongodb', () => {
  const orders = [];
  return { MongoClient: { connect: jest.fn(() => Promise.resolve({ db: () => ({ collection: () => ({ find: () => ({ toArray: () => Promise.resolve(orders) }), insertOne: (doc) => { const inserted = { _id: 'mocked-id', ...doc }; orders.push(inserted); return Promise.resolve({ insertedId: inserted._id }); } }) }) })) } };
});
const app = require('./server');
beforeAll(async () => { await app.connectDb(); });
test('GET /health', async () => { const r = await request(app).get('/health'); expect(r.status).toBe(200); });
test('GET /metrics includes request counter', async () => { const r = await request(app).get('/metrics'); expect(r.text).toMatch(/http_requests_total/); });
test('POST /orders', async () => { const r = await request(app).post('/orders').send({ dish: 'Test Dish' }); expect(r.status).toBe(201); });
test('GET /orders returns array', async () => { const r = await request(app).get('/orders'); expect(Array.isArray(r.body)).toBe(true); });
