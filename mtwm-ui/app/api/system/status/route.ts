import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY}/api/status`);
    if (!res.ok) throw new Error('Gateway unavailable');
    const data = await res.json();

    return NextResponse.json({
      connected: {
        ruvector: data.services.rvfEngine?.status === 'active',
        ruflow: true,
        claude: !!process.env.ANTHROPIC_API_KEY,
      },
      swarm: {
        activeAgents: data.activeAgents,
        queuedTasks: data.queuedTasks,
        completedToday: data.completedToday,
        agents: data.agents,
      },
    });
  } catch {
    return NextResponse.json({
      connected: { ruvector: false, ruflow: false, claude: !!process.env.ANTHROPIC_API_KEY },
      swarm: { activeAgents: 0, queuedTasks: 0, completedToday: 0, agents: [] },
    });
  }
}
