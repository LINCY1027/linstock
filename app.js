const FINMIND_TOKEN = ''; 

let myChart = null;
let currentAnalysisTimeframe = 365;
let allTaiwanStocks = [];
let latestPricesCache = JSON.parse(localStorage.getItem('lin_price_cache')) || {}; 

// === Theme & Settings Control ===
function initTheme() {
    const t = localStorage.getItem('lin_theme') || 'light';
    const a = localStorage.getItem('lin_accent') || 'blue';
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.setAttribute('data-accent', a);
    updateThemeButtons(t);
}

function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    const content = modal.querySelector('div');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        // trigger reflow
        void modal.offsetWidth;
        modal.classList.remove('opacity-0');
        content.classList.remove('translate-y-full', 'sm:translate-y-full');
    } else {
        modal.classList.add('opacity-0');
        content.classList.add('translate-y-full', 'sm:translate-y-full');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
}

function setTheme(t) {
    localStorage.setItem('lin_theme', t);
    document.documentElement.setAttribute('data-theme', t);
    updateThemeButtons(t);
    if(myChart) loadAnalysisData(document.getElementById('main-symbol-input').value, currentAnalysisTimeframe); // Redraw chart with new colors
}

function setAccent(a) {
    localStorage.setItem('lin_accent', a);
    document.documentElement.setAttribute('data-accent', a);
    if(myChart) loadAnalysisData(document.getElementById('main-symbol-input').value, currentAnalysisTimeframe);
}

function updateThemeButtons(t) {
    const btnLight = document.getElementById('btn-theme-light');
    const btnDark = document.getElementById('btn-theme-dark');
    if(t === 'light') {
        btnLight.className = 'flex-1 py-1.5 text-sm font-bold rounded-md transition-colors ios-surface shadow-sm ios-text';
        btnDark.className = 'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors text-transparent bg-clip-text bg-gradient-to-r from-gray-400 to-gray-500';
    } else {
        btnDark.className = 'flex-1 py-1.5 text-sm font-bold rounded-md transition-colors ios-surface shadow-sm ios-text';
        btnLight.className = 'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors text-transparent bg-clip-text bg-gradient-to-r from-gray-400 to-gray-500';
    }
}

function closeModal(id) {
    const el = document.getElementById(id);
    el.classList.add('opacity-0');
    el.querySelector('div').classList.remove('scale-100');
    el.querySelector('div').classList.add('scale-95');
    setTimeout(() => { el.classList.add('hidden'); el.classList.remove('opacity-0'); el.querySelector('div').classList.remove('scale-95'); }, 200);
}

// === Navigation ===
function switchView(viewId) {
    ['home', 'analysis', 'portfolio'].forEach(id => {
        document.getElementById(`view-${id}`).classList.add('hidden');
        document.getElementById(`tab-${id}`).className = 'tab-inactive h-full px-2 flex items-center transition-colors';
    });
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.getElementById(`tab-${viewId}`).className = 'tab-active h-full px-2 flex items-center transition-colors';
    
    if (viewId === 'home') renderWatchlistUI();
    if (viewId === 'analysis' && myChart) myChart.resize();
    if (viewId === 'portfolio') renderTradesUI(); 
}

// === API & Core Logic ===
async function fetchWithTimeout(url, retries = 2, timeout = 10000) {
    if (FINMIND_TOKEN) url += (url.includes('?') ? '&' : '?') + `token=${FINMIND_TOKEN}`;
    for (let i = 0; i < retries; i++) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
            const clone = response.clone();
            const text = await clone.text();
            if (text.includes("Too Many Requests") || text.includes("limit")) throw new Error("額度耗盡");
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response;
        } catch (error) {
            clearTimeout(id);
            if (i === retries - 1) {
                if (error.name === 'AbortError' || error.message.includes('Timeout')) throw new Error('伺服器無回應 (Timeout)。請稍後再試。');
                if (error.message.includes('額度耗盡')) throw new Error('API 額度已達上限，請稍候。');
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
}

async function fetchAllStocks() {
    const cachedList = localStorage.getItem('lin_stock_list');
    if (cachedList) { allTaiwanStocks = JSON.parse(cachedList); return; }
    try {
        const res = await fetchWithTimeout(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo`, 1, 8000);
        const json = await res.json();
        if(json.data) {
            allTaiwanStocks = json.data;
            localStorage.setItem('lin_stock_list', JSON.stringify(allTaiwanStocks)); 
        }
    } catch (e) { console.warn("字典載入失敗"); }
}

function showUIError(msg) {
    const oldToast = document.getElementById('toast-error');
    if (oldToast) oldToast.remove();
    const toast = document.createElement('div'); toast.id = 'toast-error';
    toast.className = 'fixed bottom-10 right-10 ios-surface border-l-2 border-[var(--sell-color)] ios-text p-4 rounded-xl shadow-lg z-50 flex items-center gap-3 transition-all';
    toast.innerHTML = `<span class="font-bold text-sm">${msg}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => { if(document.getElementById('toast-error')) document.getElementById('toast-error').remove(); }, 4000);
}

// --- Autocomplete ---
const searchInput = document.getElementById('main-symbol-input');
const autoList = document.getElementById('autocomplete-list');
let currentFocus = -1;
searchInput.addEventListener('input', function() {
    const val = this.value.toUpperCase(); closeAllLists(); if (!val) return false;
    currentFocus = -1; autoList.classList.remove('hidden');
    const matches = allTaiwanStocks.filter(s => s.stock_id.includes(val) || s.stock_name.includes(val)).slice(0, 10);
    if (matches.length === 0) { autoList.innerHTML = `<div class="p-3 text-xs ios-text-muted text-center">查無標的</div>`; return; }
    matches.forEach(stock => {
        const item = document.createElement('div'); item.className = 'autocomplete-item';
        item.innerHTML = `<span class="font-bold mono ios-text">${stock.stock_id}</span> <span class="text-xs font-medium ios-text-muted">${stock.stock_name}</span>`;
        item.addEventListener('click', () => { executeSearch(stock.stock_id); closeAllLists(); });
        autoList.appendChild(item);
    });
});
searchInput.addEventListener('keydown', function(e) {
    let items = autoList.getElementsByTagName('div');
    if (e.key === 'ArrowDown') { currentFocus++; addActive(items); } else if (e.key === 'ArrowUp') { currentFocus--; addActive(items); } else if (e.key === 'Enter') {
        e.preventDefault(); if (currentFocus > -1 && items.length > 0) items[currentFocus].click(); else { executeSearch(this.value); closeAllLists(); }
    }
});
function addActive(items) { if (!items) return false; removeActive(items); if (currentFocus >= items.length) currentFocus = 0; if (currentFocus < 0) currentFocus = (items.length - 1); items[currentFocus].classList.add('autocomplete-active'); }
function removeActive(items) { for (let i = 0; i < items.length; i++) items[i].classList.remove('autocomplete-active'); }
function closeAllLists() { autoList.innerHTML = ''; autoList.classList.add('hidden'); }
document.addEventListener('click', (e) => { if(e.target !== searchInput) closeAllLists(); });

function executeSearch(query) {
    if(!query) return; let targetId = query.trim().toUpperCase();
    const found = allTaiwanStocks.find(s => s.stock_name === targetId); if (found) targetId = found.stock_id;
    const match = targetId.match(/^([a-zA-Z0-9]+)/); if (match) targetId = match[1];
    searchInput.value = targetId; switchView('analysis'); 
    document.querySelectorAll('.tf-btn').forEach(b => {
        if(parseInt(b.dataset.days) === currentAnalysisTimeframe) {
            b.className = 'tf-btn px-5 py-1.5 rounded-lg text-sm font-bold ios-bg-primary-soft transition-all';
        } else {
            b.className = 'tf-btn px-5 py-1.5 rounded-lg text-sm font-medium ios-text-muted transition-all';
        }
    });
    loadAnalysisData(targetId, currentAnalysisTimeframe); 
}
document.getElementById('main-search-btn').addEventListener('click', () => executeSearch(searchInput.value));

let watchlist = JSON.parse(localStorage.getItem('lin_watchlist')) || [{ symbol: '006208', name: '富邦台50', tf: 365 }];
let trades = JSON.parse(localStorage.getItem('lin_trades')) || [];
function saveData() { 
    localStorage.setItem('lin_watchlist', JSON.stringify(watchlist)); 
    localStorage.setItem('lin_trades', JSON.stringify(trades)); 
    localStorage.setItem('lin_price_cache', JSON.stringify(latestPricesCache));
}

function calculateLohas(closes) {
    const n = closes.length; if (n < 2) return null;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) { sumX += i; sumY += closes[i]; sumXY += i * closes[i]; sumXX += i * i; }
    const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX); const b = (sumY - m * sumX) / n;
    let tl = [], varianceSum = 0;
    for (let i = 0; i < n; i++) { let val = m * i + b; tl.push(val); varianceSum += Math.pow(closes[i] - val, 2); }
    const sd = Math.sqrt(varianceSum / n);
    return { tl: tl.map(v => Number(v.toFixed(2))), p2sd: tl.map(v => Number((v + 2 * sd).toFixed(2))), p1sd: tl.map(v => Number((v + 1 * sd).toFixed(2))), m1sd: tl.map(v => Number((v - 1 * sd).toFixed(2))), m2sd: tl.map(v => Number((v - 2 * sd).toFixed(2))) };
}

function getZoneStatus(price, p2, p1, m1, m2) {
    if (price > p2) return { code: 'SELL', text: '極度高估', color: 'ios-bg-sell-soft ios-text-sell', textCol: 'ios-text-sell', rec: false };
    if (price > p1) return { code: 'SELL', text: '偏高估值', color: 'ios-bg-sell-soft ios-text-sell', textCol: 'ios-text-sell', rec: false };
    if (price < m2) return { code: 'BUY', text: '極度恐懼 (買進)', color: 'ios-bg-buy-soft ios-text-buy', textCol: 'ios-text-buy', rec: true };
    if (price < m1) return { code: 'BUY', text: '偏低估值 (買進)', color: 'ios-bg-buy-soft ios-text-buy', textCol: 'ios-text-buy', rec: true };
    return { code: 'OBS', text: '觀望/續抱', color: 'bg-black/5 dark:bg-white/5 ios-text', textCol: 'ios-text-muted', rec: false };
}

async function fetchAPI(symbol, days) {
    const toStr = new Date().toISOString().split('T')[0];
    const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - days);
    const fromStr = fromDate.toISOString().split('T')[0];
    const pRes = await fetchWithTimeout(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${fromStr}&end_date=${toStr}`);
    const iRes = await fetchWithTimeout(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&data_id=${symbol}`);
    const pJson = await pRes.json(); const iJson = await iRes.json();
    if (!pJson.data || pJson.data.length === 0) throw new Error("無交易資料");
    let name = iJson.data && iJson.data.length > 0 ? iJson.data[0].stock_name : "台股標的";
    return { raw: pJson.data, name };
}

function renderWatchlistUI() {
    const tbody = document.getElementById('watchlist-table'); 
    const recGrid = document.getElementById('recommendation-grid');
    tbody.innerHTML = ''; recGrid.innerHTML = ''; let hasRec = false;

    watchlist.forEach(item => {
        const cache = latestPricesCache[item.symbol];
        const priceStr = cache ? cache.price.toFixed(2) : '--';
        const statusObj = cache ? cache.status : null;
        const statusStr = statusObj ? statusObj.text : '待更新';
        const statusCol = statusObj ? statusObj.textCol : 'ios-text-muted';
        const displayName = cache ? cache.name : item.name;

        const tr = document.createElement('tr'); tr.className = "hover:bg-black/5 dark:hover:bg-white/5 transition-colors ios-text";
        tr.innerHTML = `<td class="px-6 py-4"><div class="font-bold mono">${item.symbol}</div><div class="text-[10px] ios-text-muted uppercase">${displayName}</div></td><td class="px-6 py-4"><span class="ios-bg-primary-soft px-2 py-1 rounded text-[10px] font-bold">${item.tf} 天</span></td><td class="px-6 py-4 text-right font-medium mono">${priceStr}</td><td class="px-6 py-4 text-center text-xs font-bold ${statusCol}">${statusStr}</td><td class="px-6 py-4 text-center"><button onclick="executeSearch('${item.symbol}')" class="ios-text-primary font-bold text-xs mr-3">分析</button><button onclick="removeWatchlist('${item.symbol}')" class="ios-text-muted hover:ios-text-sell text-xs">刪除</button></td>`;
        tbody.appendChild(tr);

        if (statusObj && statusObj.rec) {
            hasRec = true; const card = document.createElement('div');
            card.className = "ios-surface rounded-2xl p-5 cursor-pointer hover:border-[var(--buy-color)] transition-colors relative overflow-hidden";
            card.onclick = () => executeSearch(item.symbol);
            card.innerHTML = `<div class="flex justify-between items-start mb-3"><div><div class="font-bold mono text-xl ios-text">${item.symbol}</div><div class="text-[10px] font-medium ios-text-muted">${displayName}</div></div><span class="${statusObj.color} px-2 py-1 rounded text-[9px] font-bold tracking-widest uppercase">SIGNAL</span></div><div class="mt-4 flex items-end justify-between"><div class="text-3xl font-light mono ios-text">${priceStr}</div><div class="text-[10px] font-medium ios-text-muted">回歸: ${item.tf}d</div></div>`;
            recGrid.appendChild(card);
        }
    });
    if (!hasRec) recGrid.innerHTML = `<div class="col-span-full ios-surface border-dashed rounded-2xl p-8 text-center ios-text-muted text-xs font-medium">目前無標的落入買進區間。</div>`;
}

async function scanWatchlist() {
    document.getElementById('global-loader').classList.remove('hidden');
    document.getElementById('loader-text').innerText = '同步中...';
    for (let i = 0; i < watchlist.length; i++) {
        const item = watchlist[i];
        try {
            const data = await fetchAPI(item.symbol, item.tf);
            const closes = data.raw.map(d => d.close); const lohas = calculateLohas(closes); const latest = data.raw[data.raw.length - 1];
            const status = getZoneStatus(latest.close, lohas.p2sd[closes.length-1], lohas.p1sd[closes.length-1], lohas.m1sd[closes.length-1], lohas.m2sd[closes.length-1]);
            latestPricesCache[item.symbol] = { price: latest.close, name: data.name, status: status };
            saveData();
            if (i < watchlist.length - 1) await new Promise(resolve => setTimeout(resolve, 800)); 
        } catch (e) { console.warn(`無法掃描 ${item.symbol}`); }
    }
    document.getElementById('global-loader').classList.add('hidden');
    renderWatchlistUI(); 
}

function draw10KCombination(kData) {
    const dataLen = kData.length; if (dataLen < 10) return; 
    const recent10 = kData.slice(-10); 
    const globalHigh = Math.max(...recent10.map(d => d[3])); 
    const globalLow = Math.min(...recent10.map(d => d[2]));
    const range = globalHigh - globalLow || 1; 
    const mapY = (val) => 10 + 100 * ((globalHigh - val) / range);
    
    // Resolve dynamic colors for drawing
    const styleObj = getComputedStyle(document.body);
    const colorRed = styleObj.getPropertyValue('--sell-color').trim(); // Up in TW
    const colorGreen = styleObj.getPropertyValue('--buy-color').trim(); // Down in TW
    const colorGray = styleObj.getPropertyValue('--text-muted').trim();
    const colorBorder = styleObj.getPropertyValue('--border-color').trim();

    let svgStr = `<svg width="100%" height="100%" viewBox="0 0 460 140" preserveAspectRatio="xMidYMid meet" class="overflow-visible"><line x1="0" y1="130" x2="430" y2="130" stroke="${colorBorder}" stroke-width="1"/></svg>`;
    
    // Rebuild SVG appending
    let elements = `<line x1="0" y1="130" x2="430" y2="130" stroke="${colorBorder}" stroke-width="1"/>`;
    recent10.forEach((k, idx) => {
        const xCenter = 30 + (idx * 40); 
        const open = k[0], close = k[1], low = k[2], high = k[3];
        const isRed = close > open; 
        const color = isRed ? colorRed : (close < open ? colorGreen : colorGray);
        const yTop = Math.min(mapY(open), mapY(close)); 
        const yBot = Math.max(mapY(open), mapY(close));
        const bodyH = Math.max(2, yBot - yTop);
        elements += `<line x1="${xCenter}" y1="${mapY(high)}" x2="${xCenter}" y2="${mapY(low)}" stroke="${color}" stroke-width="1.5"/><rect x="${xCenter - 6}" y="${yTop}" width="12" height="${bodyH}" fill="${color}" rx="1.5"/>`;
    });

    elements += `<text x="440" y="${mapY(globalHigh) + 4}" font-size="10" font-weight="600" fill="${colorGray}" text-anchor="start">H:${globalHigh}</text><text x="440" y="${mapY(globalLow) + 4}" font-size="10" font-weight="600" fill="${colorGray}" text-anchor="start">L:${globalLow}</text>`;
    document.getElementById('kline-drawing-area').innerHTML = `<svg width="100%" height="100%" viewBox="0 0 460 140" preserveAspectRatio="xMidYMid meet" class="overflow-visible">${elements}</svg>`;

    let checks = [];
    const latest = recent10[9]; const prev = recent10[8]; const first = recent10[0];
    const isWeekUp = latest[1] > first[0]; 
    const isBreakout = latest[1] >= Math.max(...recent10.slice(0, 9).map(d => d[3])); 
    const isSupport = latest[2] <= Math.min(...recent10.slice(0, 9).map(d => d[2])) && latest[1] > latest[0]; 

    if (isBreakout) checks.push(`<span class="ios-text-sell">強勢突破</span> (創近兩週新高)`);
    if (isSupport) checks.push(`<span class="ios-text">低檔支撐確認</span> (探底後收漲)`);
    if (isWeekUp) checks.push(`<span class="ios-text-sell">趨勢向上</span> (雙週整體收高)`);
    else checks.push(`<span class="ios-text-buy">趨勢向下</span> (雙週整體收低)`);
    if (latest[2] > prev[3]) checks.push(`<span class="ios-text-sell">向上跳空缺口</span>`);
    if (latest[3] < prev[2]) checks.push(`<span class="ios-text-buy">向下跳空缺口</span>`);

    let html = '';
    checks.forEach(c => html += `<div class="flex items-center gap-2"><div class="w-1 h-1 bg-[var(--text-muted)] rounded-full"></div><span>${c}</span></div>`);
    document.getElementById('ana-kline-checks').innerHTML = html || '<span class="ios-text-muted">無明顯極端特徵。</span>';
}

async function loadAnalysisData(symbol, days) {
    if(!myChart) myChart = echarts.init(document.getElementById('main-chart'));
    myChart.showLoading({ text: '載入中...', color: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(), maskColor: 'transparent', textColor: getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim() });
    
    try {
        const data = await fetchAPI(symbol, days); const raw = data.raw;
        const dates = raw.map(d => d.date); const closes = raw.map(d => d.close);
        const kData = raw.map(d => [d.open, d.close, d.min, d.max]); 
        const lohas = calculateLohas(closes); 
        const latest = raw[raw.length - 1]; const prev = raw.length > 1 ? raw[raw.length - 2] : latest;
        const diff = (latest.close - prev.close).toFixed(2);
        
        const status = getZoneStatus(latest.close, lohas.p2sd[raw.length-1], lohas.p1sd[raw.length-1], lohas.m1sd[raw.length-1], lohas.m2sd[raw.length-1]);
        
        let resLine = '--', supLine = '--';
        if (kData.length >= 10) {
            const last10 = kData.slice(-10);
            resLine = Math.max(...last10.map(d => d[3])); 
            supLine = Math.min(...last10.map(d => d[2])); 
        }
        document.getElementById('ana-res').innerText = resLine !== '--' ? resLine.toFixed(2) : '--';
        document.getElementById('ana-sup').innerText = supLine !== '--' ? supLine.toFixed(2) : '--';

        latestPricesCache[symbol] = { price: latest.close, name: data.name, status: status };
        saveData();

        let duration = 0;
        for (let i = raw.length - 1; i >= 0; i--) {
            const s = getZoneStatus(closes[i], lohas.p2sd[i], lohas.p1sd[i], lohas.m1sd[i], lohas.m2sd[i]);
            if (s.code === status.code) duration++; else break;
        }

        document.getElementById('ana-date').innerText = latest.date; document.getElementById('ana-name').innerText = data.name;
        document.getElementById('ana-symbol').innerText = symbol; document.getElementById('ana-price').innerText = latest.close.toFixed(2);
        document.getElementById('ana-change').innerText = `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}`;
        document.getElementById('ana-change').className = `text-lg font-medium mono mt-1 ${diff >= 0 ? 'ios-text-sell' : 'ios-text-buy'}`;

        const card = document.getElementById('ana-decision-card');
        document.getElementById('ana-action').innerText = status.text.split(' ')[0]; document.getElementById('ana-zone').innerText = status.text.split(' ')[1] || status.text;
        document.getElementById('ana-duration').innerText = `維持 ${duration} 天`;
        card.className = `ios-surface rounded-2xl p-6 transition-colors duration-300 ${status.color}`;

        draw10KCombination(kData);

        // Chart dynamic colors
        const styleObj = getComputedStyle(document.documentElement);
        const txtCol = styleObj.getPropertyValue('--text-muted').trim();
        const splitCol = styleObj.getPropertyValue('--border-color').trim();
        const upCol = styleObj.getPropertyValue('--sell-color').trim();
        const dnCol = styleObj.getPropertyValue('--buy-color').trim();

        let markLineData = [];
        if (resLine !== '--') markLineData.push({ yAxis: resLine, name: '壓力', lineStyle: { color: upCol, type: 'dashed', opacity: 0.5 }, label: { formatter: '壓力 {c}', position: 'end', color: upCol, fontSize: 10 } });
        if (supLine !== '--') markLineData.push({ yAxis: supLine, name: '支撐', lineStyle: { color: dnCol, type: 'dashed', opacity: 0.5 }, label: { formatter: '支撐 {c}', position: 'end', color: dnCol, fontSize: 10 } });

        myChart.setOption({
            grid: { top: '8%', bottom: '12%', left: '2%', right: '8%', containLabel: true }, tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
            legend: { data: ['K線', 'TL', '+2SD', '+1SD', '-1SD', '-2SD'], bottom: 0, textStyle: { color: txtCol, fontSize: 10 }, icon: 'circle', itemWidth: 8 },
            xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: splitCol } }, axisLabel: { color: txtCol } }, 
            yAxis: { scale: true, position: 'right', splitLine: { lineStyle: { color: splitCol } }, axisLabel: { color: txtCol } },
            dataZoom: [{ type: 'inside', start: days > 365 ? 80 : 40, end: 100 }],
            series: [
                { name: 'K線', type: 'candlestick', data: kData, markLine: { data: markLineData, symbol: ['none', 'none'] }, itemStyle: { color: upCol, color0: dnCol, borderColor: upCol, borderColor0: dnCol } },
                { name: 'TL', type: 'line', data: lohas.tl, symbol: 'none', lineStyle: { color: txtCol, width: 1.5, opacity: 0.5 } },
                { name: '+2SD', type: 'line', data: lohas.p2sd, symbol: 'none', lineStyle: { color: upCol, type: 'dashed', width: 1.5, opacity: 0.7 } },
                { name: '+1SD', type: 'line', data: lohas.p1sd, symbol: 'none', lineStyle: { color: upCol, width: 1, opacity: 0.2 } },
                { name: '-1SD', type: 'line', data: lohas.m1sd, symbol: 'none', lineStyle: { color: dnCol, width: 1, opacity: 0.2 } },
                { name: '-2SD', type: 'line', data: lohas.m2sd, symbol: 'none', lineStyle: { color: dnCol, type: 'dashed', width: 1.5, opacity: 0.7 } }
            ]
        }, true);
    } catch (e) { showUIError(e.message); } finally { myChart.hideLoading(); }
}

document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tf-btn').forEach(b => b.className = 'tf-btn px-5 py-1.5 rounded-lg text-sm font-medium ios-text-muted transition-all');
        e.target.className = 'tf-btn px-5 py-1.5 rounded-lg text-sm font-bold ios-bg-primary-soft transition-all';
        currentAnalysisTimeframe = parseInt(e.target.dataset.days);
        loadAnalysisData(document.getElementById('main-symbol-input').value, currentAnalysisTimeframe);
    });
});

function addWatchlist() {
    const sym = document.getElementById('watch-symbol').value.toUpperCase();
    const tf = parseInt(document.getElementById('watch-tf').value);
    if (sym && !watchlist.find(w => w.symbol === sym)) { watchlist.push({ symbol: sym, name: '載入中', tf }); saveData(); closeModal('add-watch-modal'); renderWatchlistUI(); }
}
function removeWatchlist(sym) { watchlist = watchlist.filter(w => w.symbol !== sym); saveData(); renderWatchlistUI(); }

function saveTrade() {
    const sym = document.getElementById('trade-symbol').value.toUpperCase();
    const date = document.getElementById('trade-date').value;
    const price = parseFloat(document.getElementById('trade-price').value);
    const shares = parseInt(document.getElementById('trade-shares').value);
    const note = document.getElementById('trade-note').value;
    if(sym && date && price && shares) {
        trades.push({ id: Date.now(), sym, date, price, shares, totalCost: price * shares, note });
        saveData(); closeModal('add-trade-modal'); renderTradesUI(); 
    }
}
function removeTrade(id) { trades = trades.filter(t => t.id !== id); saveData(); renderTradesUI(); }

function renderTradesUI() {
    const tbody = document.getElementById('portfolio-table'); 
    const empty = document.getElementById('portfolio-empty');
    tbody.innerHTML = '';
    
    if (trades.length === 0) { empty.classList.remove('hidden'); return; } 
    else { empty.classList.add('hidden'); }

    trades.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-black/5 dark:hover:bg-white/5 transition-colors ios-text";
        
        let currentPriceStr = "請更新";
        let roiHtml = "<span class='ios-text-muted'>--</span>";
        
        const cache = latestPricesCache[t.sym];
        if (cache) {
            const currentPrice = cache.price;
            currentPriceStr = `$${currentPrice.toFixed(2)}`;
            const currentValue = currentPrice * t.shares;
            const pnlValue = currentValue - t.totalCost;
            const pnlPct = ((currentPrice - t.price) / t.price) * 100;
            
            if (pnlValue > 0) roiHtml = `<div class="flex flex-col"><span class="ios-text-sell font-bold">+${pnlPct.toFixed(2)}%</span></div>`;
            else if (pnlValue < 0) roiHtml = `<div class="flex flex-col"><span class="ios-text-buy font-bold">${pnlPct.toFixed(2)}%</span></div>`;
            else roiHtml = `<span class="ios-text-muted font-bold">0.00%</span>`;
            t.nameDisplay = cache.name;
        }

        tr.innerHTML = `
            <td class="px-6 py-4 mono text-[10px] ios-text-muted uppercase">${t.date}</td>
            <td class="px-6 py-4"><div class="font-bold text-sm">${t.sym}</div><div class="text-[10px] ios-text-muted">${t.nameDisplay || ''}</div></td>
            <td class="px-6 py-4 text-right font-medium mono text-sm">$${t.price}</td>
            <td class="px-6 py-4 text-right mono text-sm">${t.shares.toLocaleString()}</td>
            <td class="px-6 py-4 text-right font-medium mono text-sm">${currentPriceStr}</td>
            <td class="px-6 py-4 text-right mono text-sm">${roiHtml}</td>
            <td class="px-6 py-4 ios-text-muted font-medium text-[10px] max-w-[150px] truncate" title="${t.note}">${t.note || '-'}</td>
            <td class="px-6 py-4 text-center"><button onclick="executeSearch('${t.sym}')" class="ios-text-primary font-bold text-xs mr-3">更新</button><button onclick="removeTrade(${t.id})" class="ios-text-muted hover:ios-text-sell text-xs">結清</button></td>
        `;
        tbody.appendChild(tr);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    fetchAllStocks(); 
    document.getElementById('trade-date').valueAsDate = new Date();
    window.addEventListener('resize', () => { if(myChart) myChart.resize(); });
    switchView('home'); 
});