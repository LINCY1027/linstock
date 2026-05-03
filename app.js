// ==========================================
// 🔑 系統設定區
// ==========================================
const FINMIND_TOKEN = ''; // 若有 FinMind Token 可填入

let myChart = null;
let currentAnalysisTimeframe = 365;
let allTaiwanStocks = [];

// 全域快取：存放搜尋過的最新價格與狀態，供帳本與首頁共用
let latestPricesCache = JSON.parse(localStorage.getItem('lin_price_cache')) || {}; 

// === 🌟 SPA 視圖切換 (零 API 消耗) ===
function switchView(viewId) {
    ['home', 'analysis', 'portfolio'].forEach(id => {
        document.getElementById(`view-${id}`).classList.add('hidden');
        document.getElementById(`tab-${id}`).className = 'tab-inactive h-full px-2 flex items-center transition-colors hover:text-indigo-500';
    });
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.getElementById(`tab-${viewId}`).className = 'tab-active h-full px-2 flex items-center transition-colors';
    
    // 切換頁面時，只做「靜態畫面渲染」，絕對不主動發送 API
    if (viewId === 'home') renderWatchlistUI();
    if (viewId === 'analysis' && myChart) myChart.resize();
    if (viewId === 'portfolio') renderTradesUI(); 
}

// === 🛡️ API 防護機制 ===
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
                if (error.message.includes('額度耗盡')) throw new Error('API 額度已達上限，請稍候 15 分鐘。');
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
}

// === 📦 全台股票字典快取 (避免每次重整都消耗額度) ===
async function fetchAllStocks() {
    const cachedList = localStorage.getItem('lin_stock_list');
    if (cachedList) {
        allTaiwanStocks = JSON.parse(cachedList);
        return;
    }
    try {
        const res = await fetchWithTimeout(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo`, 1, 8000);
        const json = await res.json();
        if(json.data) {
            allTaiwanStocks = json.data;
            localStorage.setItem('lin_stock_list', JSON.stringify(allTaiwanStocks)); // 永久存入瀏覽器
        }
    } catch (e) {
        console.warn("全台股票清單載入失敗，不影響核心功能。");
    }
}

// --- UI 錯誤提示器 ---
function showUIError(msg) {
    const oldToast = document.getElementById('toast-error');
    if (oldToast) oldToast.remove();
    const toast = document.createElement('div');
    toast.id = 'toast-error';
    toast.className = 'fixed bottom-10 right-10 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded shadow-lg z-50 flex items-center gap-3 animate-bounce';
    toast.innerHTML = `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><span class="font-bold text-sm">${msg}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => { if(document.getElementById('toast-error')) document.getElementById('toast-error').remove(); }, 5000);
}

// --- Autocomplete 搜尋引擎 ---
const searchInput = document.getElementById('main-symbol-input');
const autoList = document.getElementById('autocomplete-list');
let currentFocus = -1;

searchInput.addEventListener('input', function() {
    const val = this.value.toUpperCase(); closeAllLists(); if (!val) return false;
    currentFocus = -1; autoList.classList.remove('hidden');
    const matches = allTaiwanStocks.filter(s => s.stock_id.includes(val) || s.stock_name.includes(val)).slice(0, 10);
    if (matches.length === 0) { autoList.innerHTML = `<div class="p-3 text-sm text-slate-500 text-center">查無標的</div>`; return; }
    matches.forEach(stock => {
        const item = document.createElement('div'); item.className = 'autocomplete-item';
        item.innerHTML = `<span class="font-bold mono text-slate-800">${stock.stock_id}</span> <span class="text-sm font-bold text-slate-600">${stock.stock_name}</span>`;
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

// 🚀 執行搜尋：全系統唯一會觸發 API 的入口！
function executeSearch(query) {
    if(!query) return; let targetId = query.trim().toUpperCase();
    const found = allTaiwanStocks.find(s => s.stock_name === targetId); if (found) targetId = found.stock_id;
    const match = targetId.match(/^([a-zA-Z0-9]+)/); if (match) targetId = match[1];
    searchInput.value = targetId; switchView('analysis'); 
    loadAnalysisData(targetId, currentAnalysisTimeframe); // 唯一發送 API 的地方
}
document.getElementById('main-search-btn').addEventListener('click', () => executeSearch(searchInput.value));

// --- 資料與快取存取 ---
let watchlist = JSON.parse(localStorage.getItem('lin_watchlist')) || [{ symbol: '006208', name: '富邦台50', tf: 365 }, { symbol: '2330', name: '台積電', tf: 180 }];
let trades = JSON.parse(localStorage.getItem('lin_trades')) || [];
function saveData() { 
    localStorage.setItem('lin_watchlist', JSON.stringify(watchlist)); 
    localStorage.setItem('lin_trades', JSON.stringify(trades)); 
    localStorage.setItem('lin_price_cache', JSON.stringify(latestPricesCache));
}

// --- 核心演算法 ---
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
    if (price > p2) return { code: 'SELL', text: '賣出 (極度高估)', color: 'bg-rose-600', textCol: 'text-rose-600', rec: false };
    if (price > p1) return { code: 'SELL', text: '賣出 (偏高估值)', color: 'bg-orange-500', textCol: 'text-orange-500', rec: false };
    if (price < m2) return { code: 'BUY', text: '強烈買進 (極度恐懼)', color: 'bg-emerald-600', textCol: 'text-emerald-600', rec: true };
    if (price < m1) return { code: 'BUY', text: '建議買進 (偏低估值)', color: 'bg-teal-500', textCol: 'text-teal-600', rec: true };
    return { code: 'OBS', text: '觀望/續抱 (合理區間)', color: 'bg-slate-700', textCol: 'text-slate-600', rec: false };
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

// === 🚀 靜態渲染首頁 (0 API 消耗) ===
function renderWatchlistUI() {
    const tbody = document.getElementById('watchlist-table'); 
    const recGrid = document.getElementById('recommendation-grid');
    tbody.innerHTML = ''; recGrid.innerHTML = ''; let hasRec = false;

    watchlist.forEach(item => {
        // 從全域快取抓取資料 (若無，則顯示請搜尋)
        const cache = latestPricesCache[item.symbol];
        const priceStr = cache ? cache.price.toFixed(2) : '--';
        const statusObj = cache ? cache.status : null;
        const statusStr = statusObj ? statusObj.text : '待搜尋更新';
        const statusCol = statusObj ? statusObj.textCol : 'text-slate-400';
        const displayName = cache ? cache.name : item.name;

        const tr = document.createElement('tr'); tr.className = "hover:bg-slate-50 transition-colors";
        tr.innerHTML = `
            <td class="px-8 py-5"><div class="font-black mono text-lg">${item.symbol}</div><div class="text-xs text-slate-500">${displayName}</div></td>
            <td class="px-6 py-5"><span class="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-bold">${item.tf} 天</span></td>
            <td class="px-6 py-5 text-right font-black mono text-xl">${priceStr}</td>
            <td class="px-6 py-5 text-center font-bold ${statusCol}">${statusStr}</td>
            <td class="px-8 py-5 text-center"><button onclick="executeSearch('${item.symbol}')" class="text-indigo-600 font-bold hover:bg-indigo-50 px-3 py-1.5 rounded-lg mr-2 transition">分析/更新</button><button onclick="removeWatchlist('${item.symbol}')" class="text-slate-400 hover:text-red-500 font-bold px-3 py-1.5 transition">刪除</button></td>
        `;
        tbody.appendChild(tr);

        if (statusObj && statusObj.rec) {
            hasRec = true; const card = document.createElement('div');
            card.className = "bg-white rounded-3xl shadow-sm border-2 border-emerald-100 p-6 relative overflow-hidden cursor-pointer hover:shadow-md hover:border-emerald-300 transition-all group";
            card.onclick = () => executeSearch(item.symbol);
            card.innerHTML = `<div class="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div><div class="flex justify-between items-start mb-4"><div><div class="font-black mono text-3xl text-slate-800">${item.symbol}</div><div class="text-sm font-bold text-slate-500">${displayName}</div></div><span class="${statusObj.color} text-white px-3 py-1 rounded-lg text-xs font-bold shadow-sm">AI 買進</span></div><div class="mt-4 flex items-end justify-between"><div class="text-4xl font-black mono">${priceStr}</div><div class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100">依據: ${item.tf}天回歸</div></div>`;
            recGrid.appendChild(card);
        }
    });

    if (!hasRec) recGrid.innerHTML = `<div class="col-span-full bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-10 text-center text-slate-400 font-bold text-lg">💡 透過上方「搜尋框」分析個股，符合條件之自選股將自動顯示於此。</div>`;
}

// 保留強制手動掃描按鈕 (使用者手動點擊才耗費額度)
async function scanWatchlist() {
    document.getElementById('global-loader').classList.remove('hidden');
    document.getElementById('loader-text').innerText = '手動同步全清單中，請稍候...';
    
    for (let i = 0; i < watchlist.length; i++) {
        const item = watchlist[i];
        try {
            const data = await fetchAPI(item.symbol, item.tf);
            const closes = data.raw.map(d => d.close); const lohas = calculateLohas(closes); const latest = data.raw[data.raw.length - 1];
            const status = getZoneStatus(latest.close, lohas.p2sd[closes.length-1], lohas.p1sd[closes.length-1], lohas.m1sd[closes.length-1], lohas.m2sd[closes.length-1]);
            
            // 更新全域快取
            latestPricesCache[item.symbol] = { price: latest.close, name: data.name, status: status };
            saveData();
            
            if (i < watchlist.length - 1) await new Promise(resolve => setTimeout(resolve, 1000)); // 嚴格節流 1 秒
        } catch (e) { console.warn(`無法掃描 ${item.symbol}`); }
    }
    document.getElementById('global-loader').classList.add('hidden');
    renderWatchlistUI(); // 掃描完重新靜態渲染
}

// --- 繪製 3K 教學圖 ---
function draw3KCombination(kData) {
    const dataLen = kData.length; if (dataLen < 3) return; 
    const k3 = kData[dataLen - 3]; const k2 = kData[dataLen - 2]; const k1 = kData[dataLen - 1]; 
    const globalHigh = Math.max(k3[3], k2[3], k1[3]); const globalLow = Math.min(k3[2], k2[2], k1[2]);
    const range = globalHigh - globalLow || 1; 
    const mapY = (val) => 10 + 100 * ((globalHigh - val) / range);
    
    const getKLineSVG = (open, close, low, high, xCenter) => {
        const isRed = close > open; const color = isRed ? '#f43f5e' : (close < open ? '#10b981' : '#64748b');
        const yTop = Math.min(mapY(open), mapY(close)); const yBot = Math.max(mapY(open), mapY(close));
        const bodyH = Math.max(2, yBot - yTop);
        return `<line x1="${xCenter}" y1="${mapY(high)}" x2="${xCenter}" y2="${mapY(low)}" stroke="${color}" stroke-width="2"/><rect x="${xCenter - 8}" y="${yTop}" width="16" height="${bodyH}" fill="${color}" rx="2"/>`;
    };

    let svgStr = `<svg width="180" height="140" viewBox="0 0 180 140" class="overflow-visible"><line x1="0" y1="130" x2="180" y2="130" stroke="#f1f5f9" stroke-width="2"/>`;
    svgStr += getKLineSVG(k3[0], k3[1], k3[2], k3[3], 30) + getKLineSVG(k2[0], k2[1], k2[2], k2[3], 90) + getKLineSVG(k1[0], k1[1], k1[2], k1[3], 150);
    svgStr += `<text x="175" y="${mapY(globalHigh) + 4}" font-size="10" font-weight="bold" fill="#94a3b8" text-anchor="start">H:${globalHigh}</text><text x="175" y="${mapY(globalLow) + 4}" font-size="10" font-weight="bold" fill="#94a3b8" text-anchor="start">L:${globalLow}</text></svg>`;
    document.getElementById('kline-drawing-area').innerHTML = svgStr;

    let checks = [];
    const r3 = k3[1] > k3[0]; const r2 = k2[1] > k2[0]; const r1 = k1[1] > k1[0]; 
    if (!r2 && r1 && k1[1] > k2[0] && k1[0] < k2[1]) checks.push(`<span class="text-rose-600">強勢多頭吞噬</span> (紅K包覆黑K)`);
    else if (r2 && !r1 && k1[1] < k2[0] && k1[0] > k2[1]) checks.push(`<span class="text-emerald-600">弱勢空頭吞噬</span> (黑K包覆紅K)`);
    if (r3 && r2 && r1 && k1[1] > k2[1] && k2[1] > k3[1]) checks.push(`<span class="text-rose-600">紅三兵形態</span> (連續三日收高)`);
    else if (!r3 && !r2 && !r1 && k1[1] < k2[1] && k2[1] < k3[1]) checks.push(`<span class="text-emerald-600">三隻烏鴉形態</span> (連續三日收低)`);
    if (k1[2] > k2[3]) checks.push(`<span class="text-rose-600">出現向上跳空缺口</span>`);
    if (k1[3] < k2[2]) checks.push(`<span class="text-emerald-600">出現向下跳空缺口</span>`);

    let html = '';
    if(checks.length > 0) checks.forEach(c => html += `<div class="flex items-center gap-2"><div class="w-1.5 h-1.5 bg-slate-400 rounded-full"></div><div class="font-bold text-slate-700">${c}</div></div>`);
    else html = `<div class="font-bold text-slate-500">近期 3 日處於震盪整理。</div>`;
    document.getElementById('ana-kline-checks').innerHTML = html;
}

// === 🚀 核心執行引擎 (分析並更新快取) ===
async function loadAnalysisData(symbol, days) {
    if(!myChart) myChart = echarts.init(document.getElementById('main-chart'));
    myChart.showLoading({ text: '安全資料連線中...', color: '#4f46e5' });
    try {
        const data = await fetchAPI(symbol, days); const raw = data.raw;
        const dates = raw.map(d => d.date); const closes = raw.map(d => d.close);
        const kData = raw.map(d => [d.open, d.close, d.min, d.max]); 
        const lohas = calculateLohas(closes); const latest = raw[raw.length - 1];
        const prev = raw.length > 1 ? raw[raw.length - 2] : latest;
        const diff = (latest.close - prev.close).toFixed(2);
        
        const status = getZoneStatus(latest.close, lohas.p2sd[raw.length-1], lohas.p1sd[raw.length-1], lohas.m1sd[raw.length-1], lohas.m2sd[raw.length-1]);
        
        // 🌟 更新全域快取 (首頁和帳本都會立刻受惠)
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
        document.getElementById('ana-change').className = `text-2xl font-bold mono mt-2 ${diff >= 0 ? 'text-rose-500' : 'text-emerald-500'}`;

        const card = document.getElementById('ana-decision-card');
        document.getElementById('ana-action').innerText = status.text.split(' ')[0]; document.getElementById('ana-zone').innerText = status.text.split(' ')[1] || status.text;
        document.getElementById('ana-duration').innerText = `維持 ${duration} 天`;
        card.className = `rounded-3xl shadow-xl p-8 text-white transition-colors duration-500 ${status.color}`;

        draw3KCombination(kData);

        myChart.setOption({
            grid: { top: '8%', bottom: '10%', left: '4%', right: '4%', containLabel: true }, tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
            legend: { data: ['K線', '趨勢線(TL)', '+2SD(極度貪婪)', '+1SD(高估)', '-1SD(低估)', '-2SD(極度恐懼)'], bottom: 0, textStyle: { fontWeight: 'bold' } },
            xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#cbd5e1' } } }, yAxis: { scale: true, position: 'right', splitLine: { lineStyle: { color: '#f1f5f9' } } },
            dataZoom: [{ type: 'inside', start: days > 365 ? 80 : 40, end: 100 }],
            series: [
                { name: 'K線', type: 'candlestick', data: kData, itemStyle: { color: '#f43f5e', color0: '#10b981', borderColor: '#f43f5e', borderColor0: '#10b981' } },
                { name: '趨勢線(TL)', type: 'line', data: lohas.tl, symbol: 'none', lineStyle: { color: '#94a3b8', width: 2 } },
                { name: '+2SD(極度貪婪)', type: 'line', data: lohas.p2sd, symbol: 'none', lineStyle: { color: '#fb7185', type: 'dashed', width: 2 } },
                { name: '+1SD(高估)', type: 'line', data: lohas.p1sd, symbol: 'none', lineStyle: { color: '#fda4af', opacity: 0.5 } },
                { name: '-1SD(低估)', type: 'line', data: lohas.m1sd, symbol: 'none', lineStyle: { color: '#86efac', opacity: 0.5 } },
                { name: '-2SD(極度恐懼)', type: 'line', data: lohas.m2sd, symbol: 'none', lineStyle: { color: '#4ade80', type: 'dashed', width: 2 } }
            ]
        }, true);
    } catch (e) { showUIError(e.message); } finally { myChart.hideLoading(); }
}

document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tf-btn').forEach(b => b.className = 'tf-btn px-6 py-2 rounded-lg text-sm font-bold text-slate-500 transition-all');
        e.target.className = 'tf-btn px-6 py-2 rounded-lg text-sm font-bold bg-white text-indigo-600 shadow-sm transition-all';
        currentAnalysisTimeframe = parseInt(e.target.dataset.days);
        loadAnalysisData(document.getElementById('main-symbol-input').value, currentAnalysisTimeframe);
    });
});

// --- Modal 與靜態帳本邏輯 ---
function addWatchlist() {
    const sym = document.getElementById('watch-symbol').value.toUpperCase();
    const tf = parseInt(document.getElementById('watch-tf').value);
    if (sym && !watchlist.find(w => w.symbol === sym)) { watchlist.push({ symbol: sym, name: '載入中', tf }); saveData(); document.getElementById('add-watch-modal').classList.add('hidden'); renderWatchlistUI(); }
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
        saveData(); document.getElementById('add-trade-modal').classList.add('hidden'); renderTradesUI(); 
    }
}
function removeTrade(id) { trades = trades.filter(t => t.id !== id); saveData(); renderTradesUI(); }

// 🚀 靜態渲染帳本 (0 API 消耗)
function renderTradesUI() {
    const tbody = document.getElementById('portfolio-table'); 
    const empty = document.getElementById('portfolio-empty');
    tbody.innerHTML = '';
    
    if (trades.length === 0) { empty.classList.remove('hidden'); return; } 
    else { empty.classList.add('hidden'); }

    trades.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors";
        
        let currentPriceStr = "請搜尋更新";
        let roiHtml = "<span class='text-slate-400'>--</span>";
        
        const cache = latestPricesCache[t.sym];
        if (cache) {
            const currentPrice = cache.price;
            currentPriceStr = `$${currentPrice.toFixed(2)}`;
            const currentValue = currentPrice * t.shares;
            const pnlValue = currentValue - t.totalCost;
            const pnlPct = (pnlValue / t.totalCost) * 100;
            
            if (pnlValue > 0) roiHtml = `<div class="flex flex-col"><span class="text-emerald-500 font-black">+${pnlPct.toFixed(2)}%</span><span class="text-emerald-600 text-xs font-bold">+$${pnlValue.toLocaleString()}</span></div>`;
            else if (pnlValue < 0) roiHtml = `<div class="flex flex-col"><span class="text-rose-500 font-black">${pnlPct.toFixed(2)}%</span><span class="text-rose-600 text-xs font-bold">-$${Math.abs(pnlValue).toLocaleString()}</span></div>`;
            else roiHtml = `<span class="text-slate-500 font-bold">0.00%</span>`;
            t.nameDisplay = cache.name;
        }

        tr.innerHTML = `
            <td class="px-6 py-5 mono text-slate-500">${t.date}</td>
            <td class="px-6 py-5"><div class="font-black text-lg text-indigo-700">${t.sym}</div><div class="text-xs text-slate-500 font-bold">${t.nameDisplay || ''}</div></td>
            <td class="px-6 py-5 text-right font-bold mono">$${t.price}</td>
            <td class="px-6 py-5 text-right mono">${t.shares.toLocaleString()}</td>
            <td class="px-6 py-5 text-right font-bold mono text-slate-700">${currentPriceStr}</td>
            <td class="px-6 py-5 text-right mono">${roiHtml}</td>
            <td class="px-6 py-5 text-slate-500 font-medium text-xs max-w-[200px] truncate" title="${t.note}">${t.note || '-'}</td>
            <td class="px-6 py-5 text-center"><button onclick="executeSearch('${t.sym}')" class="text-indigo-600 font-bold hover:bg-indigo-50 px-3 py-1.5 rounded-lg mr-2 transition">更新</button><button onclick="removeTrade(${t.id})" class="text-slate-300 hover:text-red-500 font-bold px-3 py-1.5 transition">結清</button></td>
        `;
        tbody.appendChild(tr);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    fetchAllStocks(); // 從 localStorage 撈取全台股票 (無消耗)
    document.getElementById('trade-date').valueAsDate = new Date();
    window.addEventListener('resize', () => { if(myChart) myChart.resize(); });
    switchView('home'); 
});