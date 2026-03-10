# MTWM Control Interface Setup

## Project Overview

Build the McGrath Trust World Model (MTWM) local control interface — a NextJS application with Three.js 3D visualizations and RuVector as the vector database backend. This is the owner-facing dashboard for an autonomous wealth generation system.

**This interface runs locally only. No external access. No authentication to external services for the UI itself.**

---

## System Context

You are building the local control interface for MTWM, an autonomous wealth system with:

- **Four revenue modules**: Algorithmic Trading, Real Estate, Business Ops, Alt Investments
- **Local algorithms**: Neural Trader, MinCut, QuDAG, RuVector, MidStream, SAFLA
- **Manager brain**: Claude API (secure calls, minimal context)
- **Orchestration**: ruflow (Claude-Flow rebranded) for agent coordination
- **Storage**: RVF containers, RuVector for SONA/ReasoningBank

The UI provides:
1. Real-time portfolio visualization (3D)
2. Module status dashboards
3. Natural language query interface
4. Decision approval workflow
5. Briefing/report display
6. System health monitoring

---

## Technology Stack

```
Frontend:       NextJS 14+ (App Router)
3D Graphics:    Three.js + React Three Fiber + Drei
Styling:        Tailwind CSS
Vector DB:      RuVector (local instance)
Orchestration:  ruflow (local agent coordination)
State:          Zustand (local state management)
Charts (2D):    Recharts (for standard charts)
```

---

## Directory Structure

```
mtwm-ui/
├── app/
│   ├── layout.tsx              # Root layout with providers
│   ├── page.tsx                # Main dashboard
│   ├── trading/
│   │   └── page.tsx            # Trading module view
│   ├── realestate/
│   │   └── page.tsx            # Real estate module view
│   ├── business/
│   │   └── page.tsx            # Business ops view
│   ├── alternatives/
│   │   └── page.tsx            # Alt investments view
│   ├── decisions/
│   │   └── page.tsx            # Pending decisions queue
│   ├── query/
│   │   └── page.tsx            # Natural language interface
│   └── api/
│       ├── claude/
│       │   └── route.ts        # Claude API proxy (secure)
│       ├── ruflow/
│       │   └── route.ts        # ruflow agent commands
│       ├── ruvector/
│       │   └── route.ts        # RuVector queries
│       └── modules/
│           └── [module]/
│               └── route.ts    # Module-specific endpoints
├── components/
│   ├── three/
│   │   ├── PortfolioGlobe.tsx      # 3D portfolio visualization
│   │   ├── AllocationPyramid.tsx   # 3D asset allocation
│   │   ├── FlowNetwork.tsx         # 3D money flow visualization
│   │   ├── RiskTerrain.tsx         # 3D risk landscape
│   │   └── Scene.tsx               # Base Three.js scene wrapper
│   ├── dashboard/
│   │   ├── ModuleCard.tsx          # Module status card
│   │   ├── MetricTile.tsx          # KPI display
│   │   ├── BriefingPanel.tsx       # Daily briefing display
│   │   └── DecisionQueue.tsx       # Pending approvals
│   ├── charts/
│   │   ├── PerformanceChart.tsx    # P&L over time
│   │   ├── AllocationPie.tsx       # Asset allocation
│   │   └── CorrelationMatrix.tsx   # Cross-asset correlation
│   ├── query/
│   │   ├── QueryInput.tsx          # NL query input
│   │   ├── QueryResponse.tsx       # Response display
│   │   └── QueryHistory.tsx        # Past queries
│   └── layout/
│       ├── Sidebar.tsx             # Navigation
│       ├── Header.tsx              # Top bar with status
│       └── SystemStatus.tsx        # Health indicators
├── lib/
│   ├── ruvector.ts             # RuVector client
│   ├── ruflow.ts               # ruflow client
│   ├── claude.ts               # Claude API client (secure)
│   ├── modules/
│   │   ├── trading.ts          # Trading module interface
│   │   ├── realestate.ts       # Real estate interface
│   │   ├── business.ts         # Business ops interface
│   │   └── alternatives.ts     # Alt investments interface
│   └── utils/
│       ├── formatters.ts       # Number/date formatting
│       └── constants.ts        # System constants
├── stores/
│   ├── portfolio.ts            # Portfolio state
│   ├── modules.ts              # Module status state
│   ├── decisions.ts            # Pending decisions state
│   └── system.ts               # System health state
├── types/
│   ├── portfolio.ts            # Portfolio types
│   ├── modules.ts              # Module types
│   ├── decisions.ts            # Decision types
│   └── ruvector.ts             # RuVector types
├── public/
│   └── textures/               # 3D textures if needed
├── tailwind.config.ts
├── next.config.js
├── package.json
└── tsconfig.json
```

---

## Phase 1: Project Initialization

### Step 1.1: Create NextJS Project

```bash
npx create-next-app@latest mtwm-ui --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"
cd mtwm-ui
```

### Step 1.2: Install Dependencies

```bash
# Core
npm install zustand

# Three.js ecosystem
npm install three @react-three/fiber @react-three/drei @types/three

# Charts
npm install recharts

# Utilities
npm install date-fns clsx

# RuVector client (if npm package exists, otherwise we'll create bindings)
# npm install ruvector
# For now, we'll create a local client that connects to RuVector's HTTP/gRPC interface
```

### Step 1.3: Configure Next.js for Three.js

Update `next.config.js`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['three'],
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    return config;
  },
}

module.exports = nextConfig
```

---

## Phase 2: Core Infrastructure

### Step 2.1: RuVector Client (`lib/ruvector.ts`)

```typescript
/**
 * RuVector Client
 * Connects to local RuVector instance for vector queries
 * Used for SONA, ReasoningBank, and semantic search
 */

interface VectorQuery {
  collection: string;
  vector?: number[];
  text?: string;  // Will be embedded locally
  topK?: number;
  filter?: Record<string, any>;
}

interface VectorResult {
  id: string;
  score: number;
  payload: Record<string, any>;
}

class RuVectorClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:6333') {
    this.baseUrl = baseUrl;
  }

  async query(params: VectorQuery): Promise<VectorResult[]> {
    const response = await fetch(`${this.baseUrl}/collections/${params.collection}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector: params.vector,
        limit: params.topK || 10,
        filter: params.filter,
        with_payload: true,
      }),
    });
    
    if (!response.ok) throw new Error(`RuVector error: ${response.statusText}`);
    return response.json();
  }

  async getSonaMemory(query: string, limit: number = 5): Promise<VectorResult[]> {
    return this.query({
      collection: 'sona',
      text: query,
      topK: limit,
    });
  }

  async getReasoningHistory(context: string, limit: number = 10): Promise<VectorResult[]> {
    return this.query({
      collection: 'reasoning_bank',
      text: context,
      topK: limit,
    });
  }

  async getMarketPatterns(embedding: number[], limit: number = 20): Promise<VectorResult[]> {
    return this.query({
      collection: 'market_patterns',
      vector: embedding,
      topK: limit,
    });
  }
}

export const ruvector = new RuVectorClient();
export type { VectorQuery, VectorResult };
```

### Step 2.2: ruflow Client (`lib/ruflow.ts`)

```typescript
/**
 * ruflow Client
 * Interfaces with local ruflow (Claude-Flow) agent orchestration
 */

interface AgentTask {
  agent: string;
  action: string;
  params: Record<string, any>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
}

interface AgentResponse {
  taskId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

interface SwarmStatus {
  activeAgents: number;
  queuedTasks: number;
  completedToday: number;
  agents: {
    name: string;
    status: 'idle' | 'busy' | 'error';
    currentTask?: string;
  }[];
}

class RuflowClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  async dispatch(task: AgentTask): Promise<AgentResponse> {
    const response = await fetch(`${this.baseUrl}/api/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    
    if (!response.ok) throw new Error(`ruflow error: ${response.statusText}`);
    return response.json();
  }

  async getStatus(): Promise<SwarmStatus> {
    const response = await fetch(`${this.baseUrl}/api/status`);
    if (!response.ok) throw new Error(`ruflow error: ${response.statusText}`);
    return response.json();
  }

  async getTaskResult(taskId: string): Promise<AgentResponse> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`);
    if (!response.ok) throw new Error(`ruflow error: ${response.statusText}`);
    return response.json();
  }

  // Convenience methods for common operations
  async requestBriefing(): Promise<AgentResponse> {
    return this.dispatch({
      agent: 'finley',
      action: 'generate_briefing',
      params: { type: 'daily' },
      priority: 'normal',
    });
  }

  async queryPortfolio(question: string): Promise<AgentResponse> {
    return this.dispatch({
      agent: 'harbor',
      action: 'query',
      params: { question },
      priority: 'high',
    });
  }
}

export const ruflow = new RuflowClient();
export type { AgentTask, AgentResponse, SwarmStatus };
```

### Step 2.3: Claude API Client (`lib/claude.ts`)

```typescript
/**
 * Claude API Client
 * Secure, minimal-context calls to Claude API
 * NEVER sends credentials, PII, or full system state
 */

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeRequest {
  messages: ClaudeMessage[];
  system?: string;
  maxTokens?: number;
}

interface ClaudeResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

class ClaudeClient {
  private apiKey: string;
  private model: string = 'claude-sonnet-4-20250514';

  constructor() {
    // API key loaded from environment, never exposed to frontend
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
  }

  async query(request: ClaudeRequest): Promise<ClaudeResponse> {
    // This runs server-side only via API route
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens || 1024,
        system: request.system || 'You are the manager brain for MTWM, an autonomous wealth system. Provide concise, actionable analysis. Never request or reference specific account numbers, credentials, or PII.',
        messages: request.messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.content[0].text,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  }

  // Sanitize any message before sending to Claude
  sanitize(text: string): string {
    // Remove any potential sensitive data patterns
    return text
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[REDACTED]')  // Card numbers
      .replace(/\b\d{9}\b/g, '[REDACTED]')  // SSN
      .replace(/\b[A-Z0-9]{10,}\b/g, '[ACCOUNT]');  // Account numbers
  }
}

export const claude = new ClaudeClient();
export type { ClaudeMessage, ClaudeRequest, ClaudeResponse };
```

---

## Phase 3: Three.js 3D Components

### Step 3.1: Scene Wrapper (`components/three/Scene.tsx`)

```typescript
'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment } from '@react-three/drei';
import { Suspense, ReactNode } from 'react';

interface SceneProps {
  children: ReactNode;
  controls?: boolean;
  environment?: boolean;
}

export function Scene({ children, controls = true, environment = true }: SceneProps) {
  return (
    <Canvas className="w-full h-full">
      <PerspectiveCamera makeDefault position={[0, 2, 5]} />
      {controls && <OrbitControls enablePan={false} />}
      {environment && <Environment preset="city" />}
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <Suspense fallback={null}>
        {children}
      </Suspense>
    </Canvas>
  );
}
```

### Step 3.2: Portfolio Globe (`components/three/PortfolioGlobe.tsx`)

```typescript
'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere, Html } from '@react-three/drei';
import * as THREE from 'three';

interface Asset {
  id: string;
  name: string;
  value: number;
  change: number;
  category: 'equity' | 'real_estate' | 'crypto' | 'cash' | 'alternative';
  lat: number;
  lng: number;
}

interface PortfolioGlobeProps {
  assets: Asset[];
  totalValue: number;
}

const categoryColors = {
  equity: '#3b82f6',
  real_estate: '#10b981',
  crypto: '#f59e0b',
  cash: '#6b7280',
  alternative: '#8b5cf6',
};

export function PortfolioGlobe({ assets, totalValue }: PortfolioGlobeProps) {
  const globeRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (globeRef.current) {
      globeRef.current.rotation.y += 0.001;
    }
  });

  const assetPoints = useMemo(() => {
    return assets.map((asset) => {
      const phi = (90 - asset.lat) * (Math.PI / 180);
      const theta = (asset.lng + 180) * (Math.PI / 180);
      const radius = 1.02;
      
      return {
        ...asset,
        position: new THREE.Vector3(
          -radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta)
        ),
        size: Math.max(0.02, (asset.value / totalValue) * 0.15),
      };
    });
  }, [assets, totalValue]);

  return (
    <group>
      {/* Globe */}
      <Sphere ref={globeRef} args={[1, 64, 64]}>
        <meshStandardMaterial
          color="#1e3a5f"
          transparent
          opacity={0.8}
          wireframe={false}
        />
      </Sphere>
      
      {/* Wireframe overlay */}
      <Sphere args={[1.01, 32, 32]}>
        <meshBasicMaterial color="#2563eb" wireframe transparent opacity={0.3} />
      </Sphere>

      {/* Asset markers */}
      {assetPoints.map((asset) => (
        <group key={asset.id} position={asset.position}>
          <Sphere args={[asset.size, 16, 16]}>
            <meshStandardMaterial
              color={categoryColors[asset.category]}
              emissive={categoryColors[asset.category]}
              emissiveIntensity={0.5}
            />
          </Sphere>
          <Html distanceFactor={3}>
            <div className="bg-slate-900/90 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
              <div className="font-semibold">{asset.name}</div>
              <div className={asset.change >= 0 ? 'text-green-400' : 'text-red-400'}>
                {asset.change >= 0 ? '+' : ''}{asset.change.toFixed(2)}%
              </div>
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}
```

### Step 3.3: Risk Terrain (`components/three/RiskTerrain.tsx`)

```typescript
'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface RiskData {
  x: number;  // Time or asset index
  z: number;  // Risk dimension
  risk: number;  // 0-1 risk level
}

interface RiskTerrainProps {
  data: RiskData[];
  width?: number;
  depth?: number;
}

export function RiskTerrain({ data, width = 10, depth = 10 }: RiskTerrainProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(width, depth, 50, 50);
    const positions = geo.attributes.position;
    
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getY(i);
      
      // Find nearest data point and interpolate
      let height = 0;
      let totalWeight = 0;
      
      data.forEach((point) => {
        const dist = Math.sqrt(
          Math.pow((x / width * 10) - point.x, 2) +
          Math.pow((z / depth * 10) - point.z, 2)
        );
        const weight = 1 / (dist + 0.1);
        height += point.risk * weight;
        totalWeight += weight;
      });
      
      positions.setZ(i, (height / totalWeight) * 2);
    }
    
    geo.computeVertexNormals();
    return geo;
  }, [data, width, depth]);

  const colorArray = useMemo(() => {
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const positions = geometry.attributes.position;
    
    for (let i = 0; i < positions.count; i++) {
      const height = positions.getZ(i) / 2;  // Normalize back to 0-1
      
      // Color gradient: green (low risk) -> yellow -> red (high risk)
      const color = new THREE.Color();
      if (height < 0.5) {
        color.setHSL(0.3 - height * 0.3, 0.8, 0.5);  // Green to yellow
      } else {
        color.setHSL(0.15 - (height - 0.5) * 0.3, 0.8, 0.5);  // Yellow to red
      }
      
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    
    return colors;
  }, [geometry]);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.1) * 0.02;
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
      <bufferAttribute
        attach="geometry-attributes-color"
        args={[colorArray, 3]}
      />
    </mesh>
  );
}
```

---

## Phase 4: Dashboard Components

### Step 4.1: Main Dashboard (`app/page.tsx`)

```typescript
'use client';

import { useEffect } from 'react';
import { Scene } from '@/components/three/Scene';
import { PortfolioGlobe } from '@/components/three/PortfolioGlobe';
import { ModuleCard } from '@/components/dashboard/ModuleCard';
import { BriefingPanel } from '@/components/dashboard/BriefingPanel';
import { DecisionQueue } from '@/components/dashboard/DecisionQueue';
import { usePortfolioStore } from '@/stores/portfolio';
import { useModulesStore } from '@/stores/modules';

export default function Dashboard() {
  const { portfolio, fetchPortfolio } = usePortfolioStore();
  const { modules, fetchModules } = useModulesStore();

  useEffect(() => {
    fetchPortfolio();
    fetchModules();
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchPortfolio();
      fetchModules();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [fetchPortfolio, fetchModules]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-blue-400">MTWM Control</h1>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-slate-400">Total Portfolio</div>
              <div className="text-xl font-semibold">
                ${portfolio.totalValue.toLocaleString()}
              </div>
            </div>
            <div className={`w-3 h-3 rounded-full ${
              portfolio.systemStatus === 'healthy' ? 'bg-green-500' :
              portfolio.systemStatus === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
            }`} />
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 border-r border-slate-800 p-4">
          <nav className="space-y-2">
            <a href="/" className="block px-4 py-2 rounded bg-slate-800 text-white">Dashboard</a>
            <a href="/trading" className="block px-4 py-2 rounded hover:bg-slate-800 text-slate-300">Trading</a>
            <a href="/realestate" className="block px-4 py-2 rounded hover:bg-slate-800 text-slate-300">Real Estate</a>
            <a href="/business" className="block px-4 py-2 rounded hover:bg-slate-800 text-slate-300">Business Ops</a>
            <a href="/alternatives" className="block px-4 py-2 rounded hover:bg-slate-800 text-slate-300">Alternatives</a>
            <a href="/decisions" className="block px-4 py-2 rounded hover:bg-slate-800 text-slate-300">Decisions</a>
            <a href="/query" className="block px-4 py-2 rounded hover:bg-slate-800 text-slate-300">Query</a>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          <div className="grid grid-cols-3 gap-6">
            {/* 3D Portfolio Globe */}
            <div className="col-span-2 bg-slate-900 rounded-xl p-4 h-96">
              <h2 className="text-lg font-semibold mb-4">Portfolio Overview</h2>
              <div className="h-80">
                <Scene>
                  <PortfolioGlobe
                    assets={portfolio.assets}
                    totalValue={portfolio.totalValue}
                  />
                </Scene>
              </div>
            </div>

            {/* Daily Briefing */}
            <div className="bg-slate-900 rounded-xl p-4 h-96 overflow-y-auto">
              <BriefingPanel />
            </div>

            {/* Module Status Cards */}
            {modules.map((module) => (
              <ModuleCard key={module.id} module={module} />
            ))}

            {/* Pending Decisions */}
            <div className="col-span-3 bg-slate-900 rounded-xl p-4">
              <DecisionQueue />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
```

### Step 4.2: Query Interface (`app/query/page.tsx`)

```typescript
'use client';

import { useState } from 'react';
import { QueryInput } from '@/components/query/QueryInput';
import { QueryResponse } from '@/components/query/QueryResponse';
import { QueryHistory } from '@/components/query/QueryHistory';

interface QueryEntry {
  id: string;
  query: string;
  response: string;
  timestamp: Date;
}

export default function QueryPage() {
  const [history, setHistory] = useState<QueryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState<string | null>(null);

  const handleQuery = async (query: string) => {
    setLoading(true);
    setCurrentResponse(null);

    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();
      
      const entry: QueryEntry = {
        id: Date.now().toString(),
        query,
        response: data.response,
        timestamp: new Date(),
      };

      setCurrentResponse(data.response);
      setHistory((prev) => [entry, ...prev]);
    } catch (error) {
      setCurrentResponse('Error processing query. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <h1 className="text-2xl font-bold mb-6">Query System</h1>
      
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <QueryInput onSubmit={handleQuery} loading={loading} />
          {currentResponse && <QueryResponse response={currentResponse} />}
        </div>
        
        <div className="bg-slate-900 rounded-xl p-4">
          <QueryHistory entries={history} />
        </div>
      </div>
    </div>
  );
}
```

---

## Phase 5: Zustand Stores

### Step 5.1: Portfolio Store (`stores/portfolio.ts`)

```typescript
import { create } from 'zustand';

interface Asset {
  id: string;
  name: string;
  value: number;
  change: number;
  category: 'equity' | 'real_estate' | 'crypto' | 'cash' | 'alternative';
  lat: number;
  lng: number;
}

interface PortfolioState {
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
  assets: Asset[];
  systemStatus: 'healthy' | 'warning' | 'critical';
  lastUpdated: Date | null;
  fetchPortfolio: () => Promise<void>;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  totalValue: 0,
  dayChange: 0,
  dayChangePercent: 0,
  assets: [],
  systemStatus: 'healthy',
  lastUpdated: null,

  fetchPortfolio: async () => {
    try {
      const response = await fetch('/api/portfolio');
      const data = await response.json();
      
      set({
        totalValue: data.totalValue,
        dayChange: data.dayChange,
        dayChangePercent: data.dayChangePercent,
        assets: data.assets,
        systemStatus: data.systemStatus,
        lastUpdated: new Date(),
      });
    } catch (error) {
      console.error('Failed to fetch portfolio:', error);
      set({ systemStatus: 'warning' });
    }
  },
}));
```

---

## Phase 6: API Routes

### Step 6.1: Query API (`app/api/query/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { claude } from '@/lib/claude';
import { ruflow } from '@/lib/ruflow';
import { ruvector } from '@/lib/ruvector';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    // 1. Search for relevant context in RuVector
    const context = await ruvector.getSonaMemory(query, 3);
    const reasoning = await ruvector.getReasoningHistory(query, 3);

    // 2. Build context for Claude
    const contextString = context
      .map((r) => r.payload.summary)
      .join('\n');

    // 3. Query Claude with sanitized input
    const sanitizedQuery = claude.sanitize(query);
    
    const response = await claude.query({
      system: `You are the MTWM manager brain. Answer questions about the portfolio, trading, real estate, and business operations. Use the provided context from system memory.

Context from SONA:
${contextString}

Be concise and actionable. If you need to trigger an action, specify which agent should handle it.`,
      messages: [
        { role: 'user', content: sanitizedQuery }
      ],
      maxTokens: 1024,
    });

    // 4. Check if response requires agent action
    if (response.content.includes('[DISPATCH:')) {
      const match = response.content.match(/\[DISPATCH:(\w+):(\w+)\]/);
      if (match) {
        const [, agent, action] = match;
        await ruflow.dispatch({
          agent,
          action,
          params: { query: sanitizedQuery },
          priority: 'normal',
        });
      }
    }

    return NextResponse.json({
      response: response.content,
      usage: response.usage,
    });
  } catch (error) {
    console.error('Query error:', error);
    return NextResponse.json(
      { error: 'Failed to process query' },
      { status: 500 }
    );
  }
}
```

---

## Execution Instructions

Run these commands in sequence using Claude Code:

```bash
# 1. Initialize project
npx create-next-app@latest mtwm-ui --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"
cd mtwm-ui

# 2. Install dependencies
npm install zustand three @react-three/fiber @react-three/drei @types/three recharts date-fns clsx

# 3. Create directory structure
mkdir -p components/{three,dashboard,charts,query,layout}
mkdir -p lib/modules lib/utils
mkdir -p stores types
mkdir -p app/{trading,realestate,business,alternatives,decisions,query}
mkdir -p app/api/{claude,ruflow,ruvector,modules,portfolio,query}

# 4. Create all files as specified above

# 5. Start development server
npm run dev
```

---

## Environment Variables

Create `.env.local`:

```bash
# Claude API (server-side only)
ANTHROPIC_API_KEY=sk-ant-...

# Local services
RUVECTOR_URL=http://localhost:6333
RUFLOW_URL=http://localhost:3001

# Security
NEXT_PUBLIC_API_URL=http://localhost:3000
```

---

## Success Criteria

1. **Dashboard loads** with 3D portfolio globe rendering
2. **Module cards** show status for all four revenue modules
3. **Query interface** successfully routes through Claude API
4. **RuVector connection** returns semantic search results
5. **ruflow integration** can dispatch agent tasks
6. **No external network calls** from UI except Claude API and configured tunnels

---

## Notes for Claude Code

- This is a **local-only** application. Do not add authentication or external service connections beyond what's specified.
- All sensitive operations go through API routes, never client-side.
- Three.js components should be marked `'use client'` for Next.js App Router.
- RuVector and ruflow URLs should be configurable via environment variables.
- The 3D visualizations are for information display, not interaction — keep them performant.

Build this systematically, testing each phase before moving to the next.
