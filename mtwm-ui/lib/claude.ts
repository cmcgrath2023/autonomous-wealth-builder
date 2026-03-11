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
  usage: { inputTokens: number; outputTokens: number };
}

class ClaudeClient {
  async query(request: ClaudeRequest): Promise<ClaudeResponse> {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`Claude API error: ${response.statusText}`);
    return response.json();
  }

  sanitize(text: string): string {
    return text
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[REDACTED]')
      .replace(/\b\d{9}\b/g, '[REDACTED]')
      .replace(/\b[A-Z0-9]{10,}\b/g, '[ACCOUNT]');
  }
}

export const claude = new ClaudeClient();
export type { ClaudeMessage, ClaudeRequest, ClaudeResponse };
