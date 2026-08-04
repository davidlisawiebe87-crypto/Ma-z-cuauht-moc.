const REFRESH_MS = 15 * 60 * 1000;
const BUSHELS_PER_METRIC_TON = 39.36825;
const API_PATH = '/.netlify/functions/dashboard';
const DEFAULT_LOCAL_ADJUSTMENT_MXN_TON = 1100;

const els = {
  refreshBtn: document.querySelector('#refreshBtn'),
  statusDot: document.querySelector('#statusDot'),
  statusText: document.querySelector('#statusText'),
  updatedAt: document.querySelector('#updatedAt'),
  cornPrice: document.querySelector('#cornPrice'),
  cornTrend: document.querySelector('#cornTrend'),
  cornMeta: document.querySelector('#cornMeta'),
  fxRate: document.querySelector('#fxRate'),
  fxMeta: document.querySelector('#fxMeta'),
  weatherTemp: document.querySelector('#weatherTemp'),
  weatherMeta: document.querySelector('#weatherMeta'),
  weatherIcon: document.querySelector('#weatherIcon'),
  mxnTon: document.querySelector('#mxnTon'),
  localMxnTon: document.querySelector('#localMxnTon'),
  localAdjustment: document.querySelector('#localAdjustment'),
  localAdjustmentText: document.querySelector('#localAdjustmentText'),
  forecastGrid: document.querySelector('#forecastGrid'),
  newsList: document.querySelector('#newsList'),
  newsBadge: document.querySelector('#newsBadge'),
  alertBox: document.querySelector('#alertBox'),
  alertTitle: document.querySelector('#alertTitle'),
  alertText: document.querySelector('#alertText'),
  newCount: document.querySelector('#newCount'),
  copyBtn: document.querySelector('#copyBtn'),
  toast: document.querySelector('#toast')
};

let latestData = null;
let lastSuccessfulUpdate = 0;
let currentChicagoMxnTon = null;
const previousSeenAt = Number(localStorage.getItem('maiz-news-seen-at') || 0);
const savedAdjustment = Number(localStorage.getItem('maiz-local-adjustment-mxn-ton'));
els.localAdjustment.value = Number.isFinite(savedAdjustment) && savedAdjustment >= 0
  ? String(savedAdjustment)
  : String(DEFAULT_LOCAL_ADJUSTMENT_MXN_TON);

function demoData() {
  const today = new Date();
  const day = 86400000;
  return {
    generatedAt: today.toISOString(),
    corn: { contract: 'Diciembre 2026', contractCode: 'ZCZ26', priceUsdBu: 4.69, changePct: -0.74, date: today.toISOString(), priceType: 'delayed_quote', source: 'Datos de demostración' },
    fx: { rate: 17.32, date: today.toISOString().slice(0, 10), source: 'Frankfurter' },
    weather: {
      current: { temperature: 20.8, wind: 13, precipitation: 0, code: 2 },
      daily: Array.from({ length: 5 }, (_, i) => ({
        date: new Date(today.getTime() + i * day).toISOString().slice(0, 10),
        max: 27 - i * .4,
        min: 12 + i * .3,
        rainProbability: [25, 40, 55, 30, 20][i],
        rain: [0.2, 1.4, 4.8, 0.5, 0][i],
        code: [2, 61, 95, 3, 1][i]
      }))
    },
    news: [
      { title: 'El mercado espera el próximo reporte de rendimiento del USDA', url: '#', source: 'Ejemplo', publishedAt: today.toISOString() },
      { title: 'Exportaciones de maíz estadounidense continúan dando apoyo al mercado', url: '#', source: 'Ejemplo', publishedAt: new Date(today.getTime() - day).toISOString() }
    ]
  };
}

async function getDirectFallback() {
  const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=28.405&longitude=-106.866&current=temperature_2m,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code&timezone=America%2FChihuahua&forecast_days=5';
  const fxUrl = 'https://api.frankfurter.dev/v1/latest?from=USD&to=MXN';
  const [weatherRes, fxRes] = await Promise.all([fetch(weatherUrl), fetch(fxUrl)]);
  if (!weatherRes.ok || !fxRes.ok) throw new Error('No fue posible cargar los datos directos.');
  const weatherRaw = await weatherRes.json();
  const fxRaw = await fxRes.json();
  return {
    generatedAt: new Date().toISOString(),
    corn: null,
    fx: { rate: fxRaw.rates.MXN, date: fxRaw.date, source: 'Frankfurter' },
    weather: {
      current: {
        temperature: weatherRaw.current.temperature_2m,
        wind: weatherRaw.current.wind_speed_10m,
        precipitation: weatherRaw.current.precipitation,
        code: weatherRaw.current.weather_code
      },
      daily: weatherRaw.daily.time.map((date, i) => ({
        date,
        max: weatherRaw.daily.temperature_2m_max[i],
        min: weatherRaw.daily.temperature_2m_min[i],
        rainProbability: weatherRaw.daily.precipitation_probability_max[i],
        rain: weatherRaw.daily.precipitation_sum[i],
        code: weatherRaw.daily.weather_code[i]
      }))
    },
    news: []
  };
}

async function loadData(manual = false) {
  setLoading(true, manual ? 'Actualizando…' : 'Buscando novedades…');
  try {
    let data;
    if (new URLSearchParams(location.search).get('demo') === '1') {
      data = demoData();
    } else {
      const response = await fetch(`${API_PATH}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
      data = await response.json();
    }
    latestData = data;
    lastSuccessfulUpdate = Date.now();
    render(data);
    setStatus('ok', 'Información actualizada');
  } catch (error) {
    console.error(error);
    try {
      const partial = await getDirectFallback();
      latestData = partial;
      lastSuccessfulUpdate = Date.now();
      render(partial);
      setStatus('ok', 'Clima y dólar actualizados; mercado y noticias requieren Netlify');
    } catch (fallbackError) {
      console.error(fallbackError);
      setStatus('error', 'No se pudo actualizar. Revisa la conexión.');
      els.newsList.innerHTML = '<p class="empty-state">No fue posible cargar las novedades en este momento.</p>';
    }
  } finally {
    setLoading(false);
  }
}

function render(data) {
  renderCorn(data.corn, data.fx);
  renderFx(data.fx);
  renderWeather(data.weather);
  renderNews(data.news || []);
  const time = new Date(data.generatedAt || Date.now());
  els.updatedAt.textContent = `Consulta ${time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderCorn(corn, fx) {
  if (!corn || !Number.isFinite(corn.priceUsdBu)) {
    els.cornPrice.textContent = 'Ver gráfico';
    els.cornTrend.textContent = 'CBOT';
    els.cornTrend.className = 'trend neutral';
    els.cornMeta.textContent = 'Cotización disponible en el gráfico';
    currentChicagoMxnTon = null;
    els.mxnTon.textContent = '—';
    els.localMxnTon.textContent = '—';
    return;
  }
  els.cornPrice.textContent = `$${corn.priceUsdBu.toFixed(2)}/bu`;
  const change = Number(corn.changePct || 0);
  els.cornTrend.textContent = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%`;
  els.cornTrend.className = `trend ${change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'}`;
  const cornLabel = corn.priceType === 'delayed_quote' ? 'Cotización retrasada' : 'Último dato disponible';
  els.cornMeta.textContent = `${cornLabel} · ${formatDateTime(corn.date)} · ${corn.contractCode || 'ZCZ26'}`;

  if (fx?.rate) {
    currentChicagoMxnTon = corn.priceUsdBu * BUSHELS_PER_METRIC_TON * fx.rate;
    els.mxnTon.textContent = formatMxn(currentChicagoMxnTon);
    updateLocalEstimate();
  }
}

function getLocalAdjustment() {
  const value = Number(els.localAdjustment.value);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_LOCAL_ADJUSTMENT_MXN_TON;
}

function formatMxn(value) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0
  }).format(value);
}

function updateLocalEstimate() {
  const adjustment = getLocalAdjustment();
  els.localAdjustmentText.textContent = formatMxn(adjustment);
  els.localMxnTon.textContent = Number.isFinite(currentChicagoMxnTon)
    ? formatMxn(currentChicagoMxnTon + adjustment)
    : '—';
}

function renderFx(fx) {
  if (!fx?.rate) return;
  els.fxRate.textContent = `$${Number(fx.rate).toFixed(4)}`;
  els.fxMeta.textContent = `Referencia diaria · ${formatDate(fx.date)} · ${fx.source || 'Fuente'}`;
}

function renderWeather(weather) {
  if (!weather?.current) return;
  const current = weather.current;
  const info = weatherInfo(current.code);
  els.weatherTemp.textContent = `${Math.round(current.temperature)} °C`;
  els.weatherIcon.textContent = info.icon;
  els.weatherMeta.textContent = `${info.label} · viento ${Math.round(current.wind || 0)} km/h`;

  els.forecastGrid.innerHTML = (weather.daily || []).map(day => {
    const d = new Date(`${day.date}T12:00:00`);
    const label = d.toLocaleDateString('es-MX', { weekday: 'short' });
    const icon = weatherInfo(day.code).icon;
    return `
      <article class="forecast-day">
        <span class="forecast-name">${escapeHtml(label)}</span>
        <span class="forecast-icon" aria-hidden="true">${icon}</span>
        <span class="forecast-temp">${Math.round(day.max)}° / ${Math.round(day.min)}°</span>
        <span class="forecast-rain">Lluvia ${Math.round(day.rainProbability || 0)}% · ${Number(day.rain || 0).toFixed(1)} mm</span>
      </article>`;
  }).join('');
}

function renderNews(news) {
  const normalized = news
    .filter(item => item?.title && item?.url)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const newItems = normalized.filter(item => new Date(item.publishedAt).getTime() > previousSeenAt);
  els.newsBadge.textContent = `${newItems.length} nueva${newItems.length === 1 ? '' : 's'}`;

  if (newItems.length > 0) {
    els.alertBox.classList.remove('hidden');
    els.alertTitle.textContent = 'Hay novedades sobre el maíz';
    els.alertText.textContent = `${newItems.length} publicación${newItems.length === 1 ? '' : 'es'} desde tu última visita.`;
    els.newCount.textContent = String(newItems.length);
  } else {
    els.alertBox.classList.add('hidden');
  }

  if (!normalized.length) {
    els.newsList.innerHTML = '<p class="empty-state">No se encontraron publicaciones nuevas en este momento.</p>';
    return;
  }

  els.newsList.innerHTML = normalized.slice(0, 10).map(item => {
    const isNew = new Date(item.publishedAt).getTime() > previousSeenAt;
    return `
      <a class="news-item" href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">
        <div>
          <h3 class="news-title">${escapeHtml(item.title)}</h3>
          <p class="news-meta">${escapeHtml(item.source || 'Fuente')} · ${formatRelative(item.publishedAt)}</p>
        </div>
        ${isNew ? '<span class="new-pill">NUEVO</span>' : '<span aria-hidden="true">›</span>'}
      </a>`;
  }).join('');

  const latestTimestamp = Math.max(...normalized.map(item => new Date(item.publishedAt).getTime()).filter(Number.isFinite), previousSeenAt);
  setTimeout(() => localStorage.setItem('maiz-news-seen-at', String(latestTimestamp)), 3000);
}

function weatherInfo(code) {
  const c = Number(code);
  if (c === 0) return { icon: '☀️', label: 'Despejado' };
  if ([1,2].includes(c)) return { icon: '🌤️', label: 'Parcialmente nublado' };
  if (c === 3) return { icon: '☁️', label: 'Nublado' };
  if ([45,48].includes(c)) return { icon: '🌫️', label: 'Niebla' };
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(c)) return { icon: '🌧️', label: 'Lluvia' };
  if ([71,73,75,77,85,86].includes(c)) return { icon: '🌨️', label: 'Nieve' };
  if ([95,96,99].includes(c)) return { icon: '⛈️', label: 'Tormenta' };
  return { icon: '🌥️', label: 'Variable' };
}

function setLoading(active, text = '') {
  els.refreshBtn.disabled = active;
  els.refreshBtn.classList.toggle('loading', active);
  if (active && text) els.statusText.textContent = text;
}

function setStatus(type, text) {
  els.statusDot.className = `status-dot ${type}`;
  els.statusText.textContent = text;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chihuahua'
  });
}

function formatRelative(value) {
  const date = new Date(value);
  const diffHours = Math.round((Date.now() - date.getTime()) / 3600000);
  if (!Number.isFinite(diffHours)) return '';
  if (diffHours < 1) return 'hace menos de una hora';
  if (diffHours < 24) return `hace ${diffHours} h`;
  const days = Math.round(diffHours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}
function escapeAttr(value) { return escapeHtml(value); }

function buildSummary() {
  if (!latestData) return 'Aún no hay datos disponibles.';
  const corn = latestData.corn;
  const fx = latestData.fx;
  const weather = latestData.weather?.current;
  const parts = ['REPORTE DE MAÍZ AMARILLO — CUAUHTÉMOC'];
  if (corn?.priceUsdBu) {
    const label = corn.priceType === 'delayed_quote' ? 'cotización retrasada' : 'último dato disponible';
    parts.push(`Maíz CBOT diciembre 2026 (${label}, ${formatDateTime(corn.date)}): $${corn.priceUsdBu.toFixed(2)} USD/bushel (${corn.changePct >= 0 ? '+' : ''}${Number(corn.changePct || 0).toFixed(2)}%).`);
  }
  if (fx?.rate) parts.push(`Dólar, referencia diaria del ${formatDate(fx.date)}: $${Number(fx.rate).toFixed(4)} MXN.`);
  if (corn?.priceUsdBu && fx?.rate) {
    const mxnTon = corn.priceUsdBu * BUSHELS_PER_METRIC_TON * fx.rate;
    const adjustment = getLocalAdjustment();
    const localEstimate = mxnTon + adjustment;
    parts.push(`Valor Chicago convertido: aproximadamente $${Math.round(mxnTon).toLocaleString('es-MX')} MXN/t antes de base, flete y margen.`);
    parts.push(`Estimado ya con ajuste local: aproximadamente $${Math.round(localEstimate).toLocaleString('es-MX')} MXN/t, usando $${Math.round(adjustment).toLocaleString('es-MX')} MXN/t de base, flete y margen.`);
  }
  if (weather) parts.push(`Clima actual: ${Math.round(weather.temperature)} °C, ${weatherInfo(weather.code).label.toLowerCase()}.`);
  const newCount = (latestData.news || []).filter(item => new Date(item.publishedAt).getTime() > previousSeenAt).length;
  parts.push(newCount ? `Hay ${newCount} novedades recientes sobre el maíz.` : 'No aparecen novedades nuevas desde la última revisión.');
  return parts.join('\n');
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 2200);
}

els.localAdjustment.addEventListener('input', () => {
  updateLocalEstimate();
  localStorage.setItem('maiz-local-adjustment-mxn-ton', String(getLocalAdjustment()));
});

els.refreshBtn.addEventListener('click', () => loadData(true));
els.copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(buildSummary());
    showToast('Resumen copiado');
  } catch {
    showToast('No se pudo copiar automáticamente');
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastSuccessfulUpdate > REFRESH_MS) loadData();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

loadData();
setInterval(() => loadData(), REFRESH_MS);
