const request = require('supertest');
const app = require('../app');
const { runMigrations } = require('../db/migrations');
const db = require('../db/connection');

// Set dummy environment variables for tests
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

// Mock data
const testUser = {
  username: `testuser${Date.now().toString().slice(-5)}`,
  email: `test${Date.now().toString().slice(-5)}user@example.com`,
  password: 'Password123!',
};

let accessToken = '';

beforeAll(async () => {
  // Ensure we are using the in-memory database
  // Run migrations to create tables
  await runMigrations();
});

describe('Books & Finance API Testing', () => {

  // 1. Health Endpoint Test
  describe('GET /api/v1/health', () => {
    it('should return health status successfully', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
    });
  });

  // 2. Auth Endpoints Test
  describe('Auth Routes (/api/v1/auth)', () => {
    it('should register a new user successfully', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(testUser);
      
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data.user).toHaveProperty('username', testUser.username);
    });

    it('should login the user and return tokens', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        });
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      
      // Store token for subsequent authenticated requests
      accessToken = res.body.data.accessToken;
    });

    it('should fail login with incorrect credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'wrongpassword'
        });
        
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // 3. CRUD Route Test (Public Feed - create and read)
  describe('Public Feed (/api/v1/public)', () => {
    let postId;

    it('should create a new public post with valid auth', async () => {
      const res = await request(app)
        .post('/api/v1/public')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          content: 'This is a test post from Jest!',
          type: 'update'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.content).toBe('This is a test post from Jest!');
      
      postId = res.body.data.id;
    });

    it('should fetch the public feed successfully', async () => {
      const res = await request(app).get('/api/v1/public');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      
      // Verify our created post is in the feed
      const createdPost = res.body.data.find(post => post.id === postId);
      expect(createdPost).toBeDefined();
    });

    it('should fail to create a post without auth', async () => {
      const res = await request(app)
        .post('/api/v1/public')
        .send({
          content: 'Secret unauthorized post'
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
