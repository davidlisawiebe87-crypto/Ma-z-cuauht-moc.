const LAT = 28.405;
const LON = -106.866;
const BUSHELS_PER_METRIC_TON = 39.36825;

export default async () => {
  const [corn, fx, weather, news] = await Promise.all([
    getCorn().catch(error => ({ error: error.message })),
    getFx().catch(error => ({ error: error.message })),
    getWeather().catch(error => ({ error: error.message })),
    getNews().catch(error => ({ error: error.message, items: [] }))
  ]);

  const body = {
    generatedAt: new Date().toISOString(),
    corn: corn?.priceUsdBu ? corn : null,
    fx: fx?.rate ? fx : null,
    weather: weather?.current ? weather : null,
    news: news?.items || [],
    diagnostics: {
      corn: corn?.error || null,
      fx: fx?.error || null,
      weather: weather?.error || null,
      news: news?.error || null,
      chicagoConvertedMxnTon: corn?.priceUsdBu && fx?.rate
        ? Math.round(corn.priceUsdBu * BUSHELS_PER_METRIC_TON * fx.rate)
        : null
    }
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
      'access-control-allow-origin': '*'
    }
  });
};

export const config = { path: '/.netlify/functions/dashboard' };

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'Maiz-Cuauhtemoc-Dashboard/1.0',
        'accept': '*/*',
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} al consultar ${new URL(url).hostname}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function getFx() {
  const response = await fetchWithTimeout('https://api.frankfurter.dev/v1/latest?from=USD&to=MXN');
  const data = await response.json();
  const rate = Number(data?.rates?.MXN);
  if (!Number.isFinite(rate)) throw new Error('Tipo de cambio inválido');
  return { rate, date: data.date, source: 'Frankfurter' };
}

async function getWeather() {
  const params = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    current: 'temperature_2m,precipitation,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code',
    timezone: 'America/Chihuahua',
    forecast_days: '5'
  });
  const response = await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`);
  const data = await response.json();
  if (!data?.current || !data?.daily?.time) throw new Error('Pronóstico inválido');
  return {
    source: 'Open-Meteo',
    current: {
      temperature: data.current.temperature_2m,
      wind: data.current.wind_speed_10m,
      precipitation: data.current.precipitation,
      code: data.current.weather_code
    },
    daily: data.daily.time.map((date, i) => ({
      date,
      max: data.daily.temperature_2m_max[i],
      min: data.daily.temperature_2m_min[i],
      rainProbability: data.daily.precipitation_probability_max[i],
      rain: data.daily.precipitation_sum[i],
      code: data.daily.weather_code[i]
    }))
  };
}

async function getCorn() {
  const errors = [];
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      return await getCornYahoo(host);
    } catch (error) {
      errors.push(`${host}: ${error.message}`);
    }
  }
  throw new Error(errors.join('; '));
}

async function getCornYahoo(host) {
  // Contrato exacto: maíz CBOT diciembre de 2026 (ZCZ26).
  const symbol = 'ZCZ26.CBT';
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=5m&includePrePost=true`;
  const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
  const data = await response.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || 'Sin datos del contrato diciembre 2026');

  const meta = result.meta || {};
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter(Number.isFinite);
  const latestRaw = firstFinite(meta.regularMarketPrice, closes.at(-1));
  const previousRaw = firstFinite(meta.chartPreviousClose, meta.previousClose, closes.at(-2), latestRaw);
  if (!Number.isFinite(latestRaw)) throw new Error('Sin cotización válida del contrato diciembre 2026');

  const priceUsdBu = normalizeCornPrice(latestRaw);
  const previous = normalizeCornPrice(previousRaw);
  const timestamp = firstFinite(meta.regularMarketTime, result.timestamp?.at(-1));
  const marketState = String(meta.marketState || '').toUpperCase();
  const delayedQuote = ['REGULAR', 'PRE', 'PREPRE', 'POST', 'POSTPOST'].includes(marketState);

  return {
    contract: 'Diciembre 2026',
    contractCode: 'ZCZ26',
    yahooSymbol: symbol,
    priceUsdBu,
    changePct: previous ? ((priceUsdBu - previous) / previous) * 100 : 0,
    date: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
    priceType: delayedQuote ? 'delayed_quote' : 'last_available',
    marketState: marketState || null,
    source: 'Yahoo Finance / CBOT diciembre 2026'
  };
}

function firstFinite(...values) {
  return values.map(Number).find(Number.isFinite);
}

function normalizeCornPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Precio inválido');
  return n > 50 ? n / 100 : n;
}

async function getNews() {
  try {
    return await getGdeltNews();
  } catch (gdeltError) {
    const google = await getGoogleNews();
    return { ...google, error: `GDELT: ${gdeltError.message}` };
  }
}

async function getGdeltNews() {
  const query = '(corn OR maize) (USDA OR CBOT OR "crop condition" OR exports) sourcelang:english';
  const params = new URLSearchParams({
    query,
    mode: 'ArtList',
    format: 'json',
    maxrecords: '20',
    sort: 'DateDesc',
    timespan: '7d'
  });
  const response = await fetchWithTimeout(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {}, 15000);
  const data = await response.json();
  const articles = Array.isArray(data?.articles) ? data.articles : [];
  const items = articles
    .map(article => ({
      title: article.title,
      url: article.url,
      source: article.domain || article.sourcecountry || 'GDELT',
      publishedAt: parseGdeltDate(article.seendate)
    }))
    .filter(item => item.title && item.url && isRelevant(item.title))
    .slice(0, 10);
  if (!items.length) throw new Error('Sin artículos relevantes');
  return { items, source: 'GDELT' };
}

async function getGoogleNews() {
  const q = '(USDA OR CBOT) corn crop exports when:7d';
  const params = new URLSearchParams({ q, hl: 'en-US', gl: 'US', ceid: 'US:en' });
  const response = await fetchWithTimeout(`https://news.google.com/rss/search?${params}`, {}, 15000);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 12).map(match => {
    const block = match[1];
    const rawTitle = extractTag(block, 'title');
    const source = extractTag(block, 'source') || 'Google News';
    return {
      title: decodeEntities(rawTitle.replace(/\s+-\s+[^-]+$/, '')),
      url: decodeEntities(extractTag(block, 'link')),
      source: decodeEntities(source),
      publishedAt: new Date(extractTag(block, 'pubDate')).toISOString()
    };
  }).filter(item => item.title && item.url && isRelevant(item.title)).slice(0, 10);
  return { items, source: 'Google News RSS' };
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : '';
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseGdeltDate(value) {
  const text = String(value || '');
  if (/^\d{14}$/.test(text)) {
    return `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}T${text.slice(8,10)}:${text.slice(10,12)}:${text.slice(12,14)}Z`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function isRelevant(title) {
  return /\b(corn|maize|usda|cbot|grain|crop|ethanol|export)\b/i.test(title || '');
}
