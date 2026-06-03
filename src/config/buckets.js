export const BUCKETS = {
  A: {
    name: 'AI / Semiconductors',
    etf: 'SOXX',
    maxPositions: 2,
    tickers: ['NVDA','AMD','MU','SNDK','ARM','AVGO','ASML','LRCX','DELL'],
    conflictPairs: [['MU','SNDK'],['ASML','LRCX']],
    noNakedCalls: false,
    rules: [
      'Never MU + SNDK simultaneously',
      'Never ASML + LRCX simultaneously',
      'No naked calls during volatility expansion',
      'Reduce size after >10% weekly sector move',
    ],
  },
  B: {
    name: 'Mega-cap Platform Tech',
    etf: 'QQQ',
    maxPositions: 2,
    tickers: ['MSFT','GOOGL','META','AAPL','AMZN','ORCL','ADBE','QQQ'],
    conflictPairs: [],
    noNakedCalls: false,
    rules: [
      'PMCC/PMCP preferred',
      'Avoid aggressive call-selling in strong uptrends',
      'Avoid overlapping mega-cap exposure',
    ],
  },
  C: {
    name: 'High-Growth Software / SaaS',
    etf: 'ARKK',
    maxPositions: 1,
    tickers: ['PLTR'],
    conflictPairs: [],
    noNakedCalls: false,
    rules: [
      'Max 1 position',
      'Prefer defined-risk structures',
      'Never hold naked premium through earnings',
    ],
  },
  D: {
    name: 'Fintech / Crypto / Digital Finance',
    etf: 'ARKF',
    maxPositions: 1,
    tickers: ['COIN','HOOD','MSTR','HIMS'],
    conflictPairs: [['COIN','MSTR']],
    noNakedCalls: false,
    rules: [
      'COIN + MSTR = same trade — never both',
      'Half-size on crypto-correlated names',
      'No oversized naked positions during Bitcoin spikes',
    ],
  },
  E: {
    name: 'Consumer / Cyclical',
    etf: 'XLY',
    maxPositions: 2,
    tickers: ['LULU','NKE','COST','TGT','HD','W','CMG','AMC','DKNG'],
    conflictPairs: [['HD','LOW'],['LULU','NKE']],
    noNakedCalls: false,
    rules: [
      'Never overlap subsectors',
      'No HD + LOW simultaneously',
      'No LULU + NKE simultaneously',
    ],
  },
  F: {
    name: 'Speculative / Meme / Squeeze',
    etf: 'ARKK',
    maxPositions: 1,
    tickers: ['CVNA','RIVN'],
    conflictPairs: [],
    noNakedCalls: true,
    rules: [
      'Max 1 position — half-size maximum',
      'No naked calls EVER',
      'Spreads only',
      'If stock moves >15% in 3 days → no new premium selling',
    ],
  },
  G: {
    name: 'Defensive / Industrial / Dividend',
    etf: 'XLI',
    maxPositions: 2,
    tickers: ['CAT'],
    conflictPairs: [],
    noNakedCalls: false,
    rules: [
      'PMCC/covered calls preferred',
      'Avoid chasing low premium',
      'Better for longer-duration structures',
    ],
  },
};

export const HARD_AVOID_NAKED = ['GME','CVNA','MSTR','QS','BLNK'];
export const MAX_TOTAL_POSITIONS = 4;
export const MAX_POSITIONS_PER_BUCKET = 2;

// Get bucket key for a ticker
export function getBucket(ticker) {
  return Object.entries(BUCKETS).find(([, b]) =>
    b.tickers.includes(ticker)
  )?.[0] ?? null;
}

// Check if adding this ticker violates any bucket conflict rule
export function getConflicts(ticker, activeTickers) {
  const bucketKey = getBucket(ticker);
  if (!bucketKey) return [];
  const bucket = BUCKETS[bucketKey];
  const conflicts = [];
  bucket.conflictPairs.forEach(([a, b]) => {
    if ((a === ticker && activeTickers.includes(b)) ||
        (b === ticker && activeTickers.includes(a))) {
      conflicts.push(`Cannot hold ${a} + ${b} simultaneously`);
    }
  });
  return conflicts;
}
