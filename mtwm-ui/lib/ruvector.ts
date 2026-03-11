import { VectorQuery, VectorResult } from '@/types/ruvector';

class RuVectorClient {
  private baseUrl: string;

  constructor(baseUrl: string = process.env.NEXT_PUBLIC_RUVECTOR_URL || 'http://localhost:6333') {
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

  async getSonaMemory(query: string, limit = 5): Promise<VectorResult[]> {
    return this.query({ collection: 'sona', text: query, topK: limit });
  }

  async getReasoningHistory(context: string, limit = 10): Promise<VectorResult[]> {
    return this.query({ collection: 'reasoning_bank', text: context, topK: limit });
  }

  async getMarketPatterns(embedding: number[], limit = 20): Promise<VectorResult[]> {
    return this.query({ collection: 'market_patterns', vector: embedding, topK: limit });
  }
}

export const ruvector = new RuVectorClient();
