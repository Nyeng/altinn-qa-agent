// Estimert pris per økt. USD per million tokens (Anthropic-listepriser, oktober 2026).
// Cache-skriving koster 1,25 × input; cache-lesing er listet separat.
// Dette er et estimat - fasiten er Usage-siden i Claude Console.

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export function estimateCostUsd(model: string, usage: Usage): number {
  const p = PRICES[model];
  if (!p) return NaN;
  return (
    (usage.input * p.input + usage.cacheWrite * p.input * 1.25 + usage.cacheRead * p.cacheRead + usage.output * p.output) /
    1_000_000
  );
}
