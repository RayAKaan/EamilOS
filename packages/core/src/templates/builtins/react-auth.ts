import { Template } from '../types.js';

export const reactAuthTemplate: Template = {
  id: 'react-auth',
  name: 'React + Auth',
  description: 'Full React app with JWT authentication, routing, and protected routes',
  category: 'web',
  version: '1.0.0',
  author: 'EamilOS',
  tags: ['react', 'auth', 'jwt', 'typescript', 'vite'],

  workflow: {
    name: 'Build React Auth App',
    steps: [
      {
        phase: 'architecture',
        agent: 'auto',
        prompt: 'Design React app architecture with auth, routing, state management. Create architecture.md and api-spec.md.',
        expectedOutputs: ['docs/architecture.md', 'docs/api-spec.md'],
      },
      {
        phase: 'frontend',
        agent: 'auto',
        prompt: 'Generate React TypeScript components: Login, Dashboard, Profile with protected routes.',
        expectedOutputs: ['src/components/*.tsx', 'src/pages/*.tsx'],
      },
      {
        phase: 'backend',
        agent: 'auto',
        prompt: 'Create Node.js API with JWT auth, user registration, login, and profile endpoints.',
        expectedOutputs: ['src/server/*.ts', 'src/routes/*.ts'],
      },
      {
        phase: 'tests',
        agent: 'auto',
        prompt: 'Write Jest tests for auth flow including login, token refresh, and protected route access.',
        expectedOutputs: ['src/**/*.test.ts'],
      },
    ],
  },

  files: [
    {
      path: 'package.json',
      template: `{
  "name": "{{projectName}}",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "server": "tsx src/server/index.ts"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "axios": "^1.6.0",
    "zustand": "^4.4.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "vitest": "^1.0.0",
    "tsx": "^4.6.0"
  }
}`,
      agent: 'auto',
    },
    {
      path: 'src/App.tsx',
      template: `import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Router } from './Router';
import { useAuthStore } from './store/authStore';

export function App() {
  const initialized = useAuthStore((s) => s.initialized);

  if (!initialized) return <div>Loading...</div>;

  return (
    <BrowserRouter>
      <Router />
    </BrowserRouter>
  );
}

export default App;`,
      agent: 'auto',
    },
    {
      path: 'src/store/authStore.ts',
      template: `import { create } from 'zustand';
import axios from 'axios';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  initialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  initialize: () => Promise<void>;
}

const api = axios.create({ baseURL: '{{apiUrl}}' });

api.interceptors.request.use((config) => {
  const token = authStore.getState().token;
  if (token) {
    config.headers.Authorization = \`Bearer \${token}\`;
  }
  return config;
});

export const authStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  initialized: false,

  initialize: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ initialized: true });
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.user, initialized: true });
    } catch {
      localStorage.removeItem('token');
      set({ token: null, initialized: true });
    }
  },

  login: async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    set({ user: data.user, token: data.token });
  },

  register: async (email: string, password: string, name: string) => {
    const { data } = await api.post('/auth/register', { email, password, name });
    localStorage.setItem('token', data.token);
    set({ user: data.user, token: data.token });
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null });
  },

  refreshToken: async () => {
    const { data } = await api.post('/auth/refresh');
    localStorage.setItem('token', data.token);
    set({ token: data.token });
  },
}));

export const useAuthStore = authStore;`,
      agent: 'auto',
    },
    {
      path: 'src/Router.tsx',
      template: `import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProfilePage } from './pages/ProfilePage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export function Router() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}`,
      agent: 'auto',
    },
    {
      path: 'src/pages/LoginPage.tsx',
      template: `import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isRegister) {
        await register(email, password, name);
      } else {
        await login(email, password);
      }
      navigate('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '4rem auto', padding: '2rem' }}>
      <h1>{isRegister ? 'Register' : 'Login'}</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        {isRegister && (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            required
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
        />
        <button type="submit">{isRegister ? 'Register' : 'Login'}</button>
      </form>
      <button onClick={() => setIsRegister(!isRegister)}>
        {isRegister ? 'Already have an account? Login' : 'Need an account? Register'}
      </button>
    </div>
  );
}`,
      agent: 'auto',
    },
    {
      path: 'src/pages/DashboardPage.tsx',
      template: `import React from 'react';
import { useAuthStore } from '../store/authStore';

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '2rem' }}>
      <h1>Dashboard</h1>
      <p>Welcome, {user?.name}!</p>
      <a href="/profile">View Profile</a>
      <button onClick={logout} style={{ marginLeft: '1rem' }}>Logout</button>
    </div>
  );
}`,
      agent: 'auto',
    },
    {
      path: 'src/pages/ProfilePage.tsx',
      template: `import React from 'react';
import { useAuthStore } from '../store/authStore';

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto', padding: '2rem' }}>
      <h1>Profile</h1>
      <p><strong>Name:</strong> {user?.name}</p>
      <p><strong>Email:</strong> {user?.email}</p>
      <p><strong>ID:</strong> {user?.id}</p>
      <a href="/dashboard">Back to Dashboard</a>
    </div>
  );
}`,
      agent: 'auto',
    },
    {
      path: 'src/server/index.ts',
      template: `import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || '{{jwtSecret}}';
const users: Map<string, { id: string; email: string; password: string; name: string }> = new Map();

app.post('/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (users.has(email)) {
    return res.status(400).json({ error: 'User already exists' });
  }
  const hashed = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();
  users.set(email, { id, email, password: hashed, name });
  const token = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id, email, name } });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users.get(email);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get('/auth/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; email: string };
    const user = users.get(payload.email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

const PORT = process.env.PORT || {{serverPort}};
app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));`,
      agent: 'auto',
    },
    {
      path: 'vite.config.ts',
      template: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: {{clientPort}},
    proxy: {
      '/api': 'http://localhost:{{serverPort}}',
    },
  },
});`,
      agent: 'auto',
    },
    {
      path: 'tsconfig.json',
      template: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
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
    min: 2.50,
    max: 4.00,
    currency: 'USD',
  },

  variables: [
    {
      name: 'projectName',
      type: 'string',
      description: 'Project name',
      default: 'my-react-auth-app',
      required: true,
    },
    {
      name: 'apiUrl',
      type: 'string',
      description: 'Backend API base URL',
      default: 'http://localhost:3001',
      required: true,
    },
    {
      name: 'serverPort',
      type: 'number',
      description: 'Backend server port',
      default: 3001,
      required: false,
    },
    {
      name: 'clientPort',
      type: 'number',
      description: 'Frontend dev server port',
      default: 5173,
      required: false,
    },
    {
      name: 'jwtSecret',
      type: 'string',
      description: 'JWT signing secret (use a strong random string)',
      default: 'change-me-in-production',
      required: true,
    },
  ],
};
