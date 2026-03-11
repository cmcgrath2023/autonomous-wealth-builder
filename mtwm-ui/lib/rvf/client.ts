import { RVFContainer, RVFAttestation } from '@/types/rvf';

class RVFClient {
  private baseUrl: string;

  constructor(baseUrl: string = '/api/rvf') {
    this.baseUrl = baseUrl;
  }

  async create(container: Omit<RVFContainer, 'id' | 'createdAt' | 'updatedAt' | 'witnessHash'>): Promise<RVFContainer> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(container),
    });
    if (!response.ok) throw new Error(`RVF create error: ${response.statusText}`);
    return response.json();
  }

  async get(id: string): Promise<RVFContainer> {
    const response = await fetch(`${this.baseUrl}/${id}`);
    if (!response.ok) throw new Error(`RVF get error: ${response.statusText}`);
    return response.json();
  }

  async update(id: string, payload: Record<string, unknown>): Promise<RVFContainer> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    });
    if (!response.ok) throw new Error(`RVF update error: ${response.statusText}`);
    return response.json();
  }

  async list(type?: RVFContainer['type']): Promise<RVFContainer[]> {
    const url = type ? `${this.baseUrl}?type=${type}` : this.baseUrl;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`RVF list error: ${response.statusText}`);
    return response.json();
  }

  async getHistory(id: string): Promise<RVFAttestation[]> {
    const response = await fetch(`${this.baseUrl}/${id}/history`);
    if (!response.ok) throw new Error(`RVF history error: ${response.statusText}`);
    return response.json();
  }

  async verify(id: string): Promise<{ valid: boolean; chain: RVFAttestation[] }> {
    const response = await fetch(`${this.baseUrl}/${id}/verify`);
    if (!response.ok) throw new Error(`RVF verify error: ${response.statusText}`);
    return response.json();
  }
}

export const rvf = new RVFClient();
