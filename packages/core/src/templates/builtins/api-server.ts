import { Template } from '../types.js';

export const apiServerTemplate: Template = {
  id: 'api-server',
  name: 'REST API Server',
  description: 'Production-ready REST API with authentication, validation, and rate limiting',
  category: 'api',
  version: '1.0.0',
  author: 'EamilOS',
  tags: ['rest', 'api', 'node', 'express', 'typescript', 'auth'],

  workflow: {
    name: 'Build REST API Server',
    steps: [
      {
        phase: 'design',
        agent: 'auto',
        prompt: 'Design REST API with resource models, authentication flow, and endpoint structure.',
        expectedOutputs: ['docs/api-spec.md'],
      },
      {
        phase: 'core',
        agent: 'auto',
        prompt: 'Implement Express server with routing, middleware, error handling, and database setup.',
        expectedOutputs: ['src/index.ts', 'src/routes/*.ts', 'src/middleware/*.ts'],
      },
      {
        phase: 'models',
        agent: 'auto',
        prompt: 'Create data models with validation and CRUD operations.',
        expectedOutputs: ['src/models/*.ts'],
      },
      {
        phase: 'tests',
        agent: 'auto',
        prompt: 'Write integration tests for all API endpoints.',
        expectedOutputs: ['tests/**/*.test.ts'],
      },
    ],
  },

  files: [
    {
      path: 'package.json',
      template: `{
  "name": "{{projectName}}",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest"
  },
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.0",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.0",
    "bcrypt": "^5.1.0",
    "zod": "^3.22.0",
    "better-sqlite3": "^9.4.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/bcrypt": "^5.0.0",
    "tsx": "^4.6.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}`,
      agent: 'auto',
    },
    {
      path: 'src/index.ts',
      template: `import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { registerRoutes } from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { rateLimit } from './middleware/rate-limit.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 100 }));

registerRoutes(app);
app.use(errorHandler);

const PORT = process.env.PORT || {{port}};
app.listen(PORT, () => console.log(\`API server running on port \${PORT}\`));`,
      agent: 'auto',
    },
    {
      path: 'src/routes/index.ts',
      template: `import { Express } from 'express';
import { authRouter } from './auth.js';
import { usersRouter } from './users.js';
import { healthRouter } from './health.js';
import { authMiddleware } from '../middleware/auth.js';

export function registerRoutes(app: Express): void {
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', authMiddleware, usersRouter);
}`,
      agent: 'auto',
    },
    {
      path: 'src/routes/auth.ts',
      template: `import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { getDb } from '../db.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(data.password, 10);
    const result = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(
      data.email, hashed, data.name
    );

    const token = jwt.sign({ id: result.lastInsertRowid, email: data.email }, process.env.JWT_SECRET || '{{jwtSecret}}', { expiresIn: '24h' });
    res.status(201).json({ token, user: { id: result.lastInsertRowid, email: data.email, name: data.name } });
  } catch (e) { next(e); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email) as any;
    if (!user || !(await bcrypt.compare(data.password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || '{{jwtSecret}}', { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) { next(e); }
});`,
      agent: 'auto',
    },
    {
      path: 'src/routes/users.ts',
      template: `import { Router } from 'express';
import { getDb } from '../db.js';

export const usersRouter = Router();

usersRouter.get('/', (_req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, email, name, created_at FROM users').all();
  res.json(users);
});

usersRouter.get('/:id', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

usersRouter.put('/:id', (req, res) => {
  const db = getDb();
  const { name } = req.body;
  const result = db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'User updated' });
});

usersRouter.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'User deleted' });
});`,
      agent: 'auto',
    },
    {
      path: 'src/routes/health.ts',
      template: `import { Router } from 'express';
import { getDb } from '../db.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const db = getDb();
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'healthy', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
  }
});`,
      agent: 'auto',
    },
    {
      path: 'src/middleware/auth.ts',
      template: `import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const payload = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET || '{{jwtSecret}}');
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}`,
      agent: 'auto',
    },
    {
      path: 'src/middleware/error-handler.ts',
      template: `import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.errors });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}`,
      agent: 'auto',
    },
    {
      path: 'src/middleware/rate-limit.ts',
      template: `import { Request, Response, NextFunction } from 'express';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const store = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + config.windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > config.maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    next();
  };
}`,
      agent: 'auto',
    },
    {
      path: 'src/db.ts',
      template: `import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database | null = null;

const SCHEMA = \`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
\`;

export function initDb(dbPath: string = './data.db'): Database.Database {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function getDb(): Database.Database {
  if (!db) return initDb();
  return db;
}`,
      agent: 'auto',
    },
    {
      path: 'tsconfig.json',
      template: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}`,
      agent: 'auto',
    },
  ],

  postGenerate: {
    commands: ['npm install', 'npm run build'],
    installDeps: true,
    gitInit: true,
  },

  estimatedCost: {
    min: 3.00,
    max: 5.00,
    currency: 'USD',
  },

  variables: [
    {
      name: 'projectName',
      type: 'string',
      description: 'Project name',
      default: 'my-api-server',
      required: true,
    },
    {
      name: 'port',
      type: 'number',
      description: 'Server port',
      default: 3000,
      required: false,
    },
    {
      name: 'jwtSecret',
      type: 'string',
      description: 'JWT signing secret',
      default: 'change-me-in-production',
      required: true,
    },
  ],
};
