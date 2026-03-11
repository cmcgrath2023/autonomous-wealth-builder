'use client';

import { useState } from 'react';
import { Input, Button } from '@heroui/react';

interface QueryInputProps {
  onSubmit: (query: string) => void;
  loading?: boolean;
}

export function QueryInput({ onSubmit, loading }: QueryInputProps) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSubmit(query.trim());
      setQuery('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <Input
        value={query}
        onValueChange={setQuery}
        placeholder="Ask about portfolio, trading signals, real estate pipeline..."
        size="lg"
        variant="bordered"
        classNames={{ inputWrapper: 'bg-white/5 border-white/10' }}
        className="flex-1"
      />
      <Button type="submit" color="primary" size="lg" isLoading={loading} isIconOnly aria-label="Send">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 15V3M9 3L3 9M9 3L15 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </Button>
    </form>
  );
}
