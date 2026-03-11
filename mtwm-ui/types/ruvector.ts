export interface VectorQuery {
  collection: string;
  vector?: number[];
  text?: string;
  topK?: number;
  filter?: Record<string, unknown>;
}

export interface VectorResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}
