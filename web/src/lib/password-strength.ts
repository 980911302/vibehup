export function strengthOf(p: string): { score: number; text: string } {
  let score = 0;
  if (p.length >= 8) score++;
  if (/[a-zA-Z]/.test(p) && /\d/.test(p)) score++;
  if (p.length >= 12) score++;
  return { score: Math.min(score, 2), text: ['弱', '中', '强'][Math.min(score, 2)] };
}

