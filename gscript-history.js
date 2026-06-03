// ─────────────────────────────────────────────────────────────────────────────
// ADD THIS BLOCK at the top of your existing doGet(e) function:
//
//   function doGet(e) {
//     if (e.parameter.action === 'history') return getHistoryResponse(e);  // ← ADD
//     ... rest of your existing code ...
//   }
//
// Then paste getHistoryResponse() and aggregateBars() anywhere in the script.
// ─────────────────────────────────────────────────────────────────────────────

function getHistoryResponse(e) {
  var tickers = (e.parameter.tickers || '').split(',').filter(function(t) { return t.trim(); });
  if (!tickers.length) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'no tickers' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var cache  = CacheService.getScriptCache();
  var result = {};
  var toFetch = [];

  // Return cached ticker data immediately; collect what needs fetching
  tickers.forEach(function(ticker) {
    var hit = cache.get('hist2_' + ticker);
    if (hit) {
      result[ticker] = JSON.parse(hit);
    } else {
      toFetch.push(ticker);
    }
  });

  if (toFetch.length > 0) {
    var configs = [
      { key: 'W',  interval: '1wk', range: '2y'  },
      { key: 'D',  interval: '1d',  range: '6mo' },
      { key: '4H', interval: '1h',  range: '3mo' }, // aggregated → 4H below
      { key: '1H', interval: '1h',  range: '1mo' },
    ];

    // Build flat request list for fetchAll (parallel)
    var requests = [];
    toFetch.forEach(function(ticker) {
      configs.forEach(function(cfg) {
        requests.push({
          ticker: ticker,
          key:    cfg.key,
          urlObj: {
            url: 'https://query2.finance.yahoo.com/v8/finance/chart/' +
                 encodeURIComponent(ticker) +
                 '?interval=' + cfg.interval +
                 '&range='    + cfg.range +
                 '&includePrePost=false',
            headers:            { 'User-Agent': 'Mozilla/5.0 (compatible; GScript)' },
            muteHttpExceptions: true,
          }
        });
      });
    });

    var responses = UrlFetchApp.fetchAll(requests.map(function(r) { return r.urlObj; }));

    requests.forEach(function(req, i) {
      try {
        var res = responses[i];
        if (res.getResponseCode() !== 200) return;
        var json      = JSON.parse(res.getContentText());
        var chartRes  = json && json.chart && json.chart.result && json.chart.result[0];
        if (!chartRes || !chartRes.timestamp) return;

        var ts = chartRes.timestamp;
        var q  = chartRes.indicators.quote[0];

        // Collect valid bars as [timestamp, high, low, close]
        var candles = [];
        for (var j = 0; j < ts.length; j++) {
          if (q.close[j] == null || q.high[j] == null || q.low[j] == null) continue;
          candles.push([ts[j], q.high[j], q.low[j], q.close[j]]);
        }

        if (!result[req.ticker]) result[req.ticker] = {};

        // Aggregate 1H → 4H by grouping 4 consecutive bars
        result[req.ticker][req.key] = (req.key === '4H')
          ? aggregateBars(candles, 4)
          : candles;

      } catch (err) { /* skip bad responses */ }
    });

    // Cache each fetched ticker for 6 hours (21600 seconds)
    toFetch.forEach(function(ticker) {
      if (result[ticker]) {
        try {
          cache.put('hist2_' + ticker, JSON.stringify(result[ticker]), 21600);
        } catch (err) { /* skip if over size limit */ }
      }
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ history: result }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Groups consecutive candle bars [t,h,l,c] into larger bars
function aggregateBars(candles, groupSize) {
  var out = [];
  for (var i = 0; i < candles.length; i += groupSize) {
    var slice = candles.slice(i, Math.min(i + groupSize, candles.length));
    if (!slice.length) continue;
    var h = slice[0][1], l = slice[0][2];
    for (var j = 1; j < slice.length; j++) {
      if (slice[j][1] > h) h = slice[j][1];
      if (slice[j][2] < l) l = slice[j][2];
    }
    out.push([slice[0][0], h, l, slice[slice.length - 1][3]]);
  }
  return out;
}
