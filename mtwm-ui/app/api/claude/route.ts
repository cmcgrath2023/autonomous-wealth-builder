import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Claude API not configured' }, { status: 503 });
    }

    const { messages, system, maxTokens } = await request.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens || 1024,
        system: system || 'You are the manager brain for MTWM, an autonomous wealth system. Provide concise, actionable analysis. Never request or reference specific account numbers, credentials, or PII.',
        messages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error: `Claude API error: ${error}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json({
      content: data.content[0].text,
      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to query Claude' }, { status: 500 });
  }
}
