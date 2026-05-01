import { Template } from '../types.js';

export const microservicesTemplate: Template = {
  id: 'microservices',
  name: 'Microservices Architecture',
  description: 'Multi-service architecture with API gateway, auth service, and worker service',
  category: 'api',
  version: '1.0.0',
  author: 'EamilOS',
  tags: ['microservices', 'node', 'docker', 'api-gateway', 'typescript'],

  workflow: {
    name: 'Build Microservices Architecture',
    steps: [
      {
        phase: 'design',
        agent: 'auto',
        prompt: 'Design microservices architecture with service boundaries, communication patterns, and data flow.',
        expectedOutputs: ['docs/architecture.md', 'docs/service-map.md'],
      },
      {
        phase: 'gateway',
        agent: 'auto',
        prompt: 'Create API gateway with routing, rate limiting, and auth forwarding.',
        expectedOutputs: ['gateway/src/index.ts', 'gateway/src/routes.ts'],
      },
      {
        phase: 'services',
        agent: 'auto',
        prompt: 'Create user service and order service with REST APIs and inter-service communication.',
        expectedOutputs: ['services/user/src/index.ts', 'services/order/src/index.ts'],
      },
      {
        phase: 'docker',
        agent: 'auto',
        prompt: 'Create Docker Compose setup for all services with networking and health checks.',
        expectedOutputs: ['docker-compose.yml', 'gateway/Dockerfile', 'services/*/Dockerfile'],
      },
    ],
  },

  files: [
    {
      path: 'package.json',
      template: `{
  "name": "{{projectName}}",
  "private": true,
  "workspaces": ["gateway", "services/*"],
  "scripts": {
    "dev": "docker-compose up",
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces"
  }
}`,
      agent: 'auto',
    },
    {
      path: 'gateway/package.json',
      template: `{
  "name": "{{projectName}}-gateway",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "vitest"
  },
  "dependencies": {
    "express": "^4.18.0",
    "http-proxy-middleware": "^2.0.0",
    "cors": "^2.8.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "tsx": "^4.6.0",
    "typescript": "^5.3.0"
  }
}`,
      agent: 'auto',
    },
    {
      path: 'gateway/src/index.ts',
      template: `import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
app.use(cors());
app.use(express.json());

const SERVICES: Record<string, string> = {
  user: process.env.USER_SERVICE_URL || 'http://user-service:{{userPort}}',
  order: process.env.ORDER_SERVICE_URL || 'http://order-service:{{orderPort}}',
};

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  (req as any).token = token;
  next();
}

app.use('/api/users', authMiddleware, createProxyMiddleware({ target: SERVICES.user, changeOrigin: true }));
app.use('/api/orders', authMiddleware, createProxyMiddleware({ target: SERVICES.order, changeOrigin: true }));

app.get('/health', (_req, res) => res.json({ status: 'ok', services: Object.keys(SERVICES) }));

const PORT = process.env.PORT || {{gatewayPort}};
app.listen(PORT, () => console.log(\`API Gateway on port \${PORT}\`));`,
      agent: 'auto',
    },
    {
      path: 'docker-compose.yml',
      template: `version: '3.8'

services:
  gateway:
    build: ./gateway
    ports:
      - "{{gatewayPort}}:{{gatewayPort}}"
    environment:
      - USER_SERVICE_URL=http://user-service:{{userPort}}
      - ORDER_SERVICE_URL=http://order-service:{{orderPort}}
      - PORT={{gatewayPort}}
    depends_on:
      user-service:
        condition: service_healthy
      order-service:
        condition: service_healthy
    networks:
      - app-network

  user-service:
    build: ./services/user
    ports:
      - "{{userPort}}:{{userPort}}"
    environment:
      - PORT={{userPort}}
      - DATABASE_URL=postgresql://user:pass@db:5432/users
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:{{userPort}}/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - app-network

  order-service:
    build: ./services/order
    ports:
      - "{{orderPort}}:{{orderPort}}"
    environment:
      - PORT={{orderPort}}
      - DATABASE_URL=postgresql://user:pass@db:5432/orders
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:{{orderPort}}/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - app-network

networks:
  app-network:
    driver: bridge`,
      agent: 'auto',
    },
  ],

  postGenerate: {
    commands: ['npm install', 'docker-compose up -d'],
    installDeps: true,
    gitInit: true,
  },

  estimatedCost: {
    min: 4.00,
    max: 7.00,
    currency: 'USD',
  },

  variables: [
    {
      name: 'projectName',
      type: 'string',
      description: 'Project name',
      default: 'my-microservices',
      required: true,
    },
    {
      name: 'gatewayPort',
      type: 'number',
      description: 'API Gateway port',
      default: 3000,
      required: false,
    },
    {
      name: 'userPort',
      type: 'number',
      description: 'User service port',
      default: 3001,
      required: false,
    },
    {
      name: 'orderPort',
      type: 'number',
      description: 'Order service port',
      default: 3002,
      required: false,
    },
  ],
};
