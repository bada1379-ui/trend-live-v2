(() => {
  "use strict";

  const ACTIVE12 = [
    ["069500.KS","KODEX 200"],
    ["229200.KS","KODEX 코스닥150"],
    ["133690.KS","TIGER 미국나스닥100"],
    ["360750.KS","TIGER 미국S&P500"],
    ["245340.KS","TIGER 미국다우존스30"],
    ["466920.KS","SOL 조선TOP3플러스"],
    ["449450.KS","PLUS K방산"],
    ["487240.KS","KODEX AI전력핵심설비"],
    ["305540.KS","TIGER 2차전지테마"],
    ["139260.KS","TIGER 200 IT"],
    ["157500.KS","TIGER 200 증권"],
    ["091180.KS","KODEX 자동차"]
  ];

  const STORAGE_KEY = "etfTrendLiveV1State";
  const SIGNAL_CACHE_KEY = "etfTrendLiveV1Signals";
  const MAX_SLOTS = 6;

  const defaultState = () => ({
    schema: 1,
    cash: 0,
    lots: [],
    ledger: [],
    selectedVersion: "daily", lastBackupAt: null,
    lastContributionAt: null,
    createdAt: new Date().toISOString()
  });

  let state = loadState();
  let signals = null;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const nowKST = () => new Date(new Date().toLocaleString("en-US", {timeZone:"Asia/Seoul"}));

  function uid(prefix="id"){
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  }

  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? {...defaultState(), ...JSON.parse(raw)} : defaultState();
    } catch {
      return defaultState();
    }
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function money(v){
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return `${Math.round(n).toLocaleString("ko-KR")}원`;
  }

  function moneyCompact(v){
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const sign = n < 0 ? "-" : "";
    const a = Math.abs(n);
    if (a >= 100000000){
      const eok = Math.floor(a / 100000000);
      const man = Math.round((a % 100000000) / 10000);
      return `${sign}${eok}억${man ? ` ${man.toLocaleString("ko-KR")}만원` : ""}`;
    }
    if (a >= 10000) return `${sign}${Math.round(a/10000).toLocaleString("ko-KR")}만원`;
    return money(n);
  }

  function price(v){
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return `${Math.round(n).toLocaleString("ko-KR")}원`;
  }

  function one(v){
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(1);
  }

  function pct(v, digits=1){
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(digits)}%`;
  }

  function dateTimeKST(iso){
    if (!iso) return "아직 생성되지 않음";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("ko-KR",{
      timeZone:"Asia/Seoul", year:"numeric",month:"2-digit",day:"2-digit",
      weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false
    }).format(d) + " KST";
  }

  function itemName(ticker){
    return ACTIVE12.find(x=>x[0]===ticker)?.[1] || ticker;
  }

  function activeLots(){
    return state.lots.filter(l => l.active !== false && Number(l.shares) > 0);
  }

  function openCostBasis(ticker=null){
    return activeLots()
      .filter(l => !ticker || l.ticker === ticker)
      .reduce((s,l)=>s+Number(l.cost || 0),0);
  }

  function confirmedCapital(){
    return Number(state.cash || 0) + openCostBasis();
  }

  function slotTarget(){
    return confirmedCapital() / MAX_SLOTS;
  }

  function heldTickers(){
    return [...new Set(activeLots().map(l=>l.ticker))];
  }

  function getVersionData(version=state.selectedVersion){
    if (!signals) return null;
    const v = signals[version];
    if (v && Array.isArray(v.items)) return v;
    const fallback = signals.daily?.items ? signals.daily : (version === "final" ? signals.first : signals.final);
    return fallback && Array.isArray(fallback.items) ? fallback : null;
  }

  function signalMap(version=state.selectedVersion){
    const v = getVersionData(version);
    return new Map((v?.items || []).map(x=>[x.ticker,x]));
  }

  function marketEquity(){
    const sm = signalMap();
    const market = activeLots().reduce((s,l)=>{
      const px = Number(sm.get(l.ticker)?.close);
      const val = Number.isFinite(px) ? px * Number(l.shares) : Number(l.cost || 0);
      return s + val;
    },0);
    return Number(state.cash || 0) + market;
  }

  function unrealizedPnl(){
    return marketEquity() - confirmedCapital();
  }

  function addLedger(type, description, amount, meta={}){
    state.ledger.unshift({
      id: uid("ledger"),
      at: new Date().toISOString(),
      type, description, amount:Number(amount)||0, meta
    });
    state.ledger = state.ledger.slice(0,500);
  }

  async function loadSignals(force=false){
    const q = force ? `?t=${Date.now()}` : "";
    try {
      const res = await fetch(`./data/signals.json${q}`, {cache:"no-store"});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      signals = await res.json();
      localStorage.setItem(SIGNAL_CACHE_KEY, JSON.stringify(signals));
      showMessage("주간 신호를 불러왔습니다.","good",1800);
    } catch (e) {
      try {
        signals = JSON.parse(localStorage.getItem(SIGNAL_CACHE_KEY) || "null");
      } catch { signals = null; }
      if (!signals) showMessage("신호 파일을 불러오지 못했습니다. data/signals.json을 확인하세요.","bad");
    }
    render();
  }

  function showMessage(text, kind="good", timeout=0){
    const el=$("#messageBanner");
    el.className=`banner ${kind}`;
    el.textContent=text;
    el.classList.remove("hidden");
    if(timeout) setTimeout(()=>el.classList.add("hidden"),timeout);
  }

  function renderVersionCards(){
    const cards=[
      ["daily",signals?.daily,$("#dailyVersionCard"),"오늘 상태 · 매일 17:00"],
      ["first",signals?.first,$("#firstVersionCard"),"1차 · 금요일 17:00"],
      ["final",signals?.final,$("#finalVersionCard"),"최종 · 토요일 10:00"]
    ];
    for(const [key,v,el,label] of cards){
      el.className=`version-card ${state.selectedVersion===key?"current":""}`;
      el.innerHTML=`<div class="version-label">${label} KST</div><div class="version-time">${v?dateTimeKST(v.generated_at):"아직 생성되지 않음"}</div><div class="version-meta">${v?`완료주봉 ${v.week_ending||"—"} · ${v.items?.length||0}/12`:"데이터 없음"}</div>`;
    }
    $("#dailyVersionBtn").classList.toggle("active",state.selectedVersion==="daily");
    $("#firstVersionBtn").classList.toggle("active",state.selectedVersion==="first");
    $("#finalVersionBtn").classList.toggle("active",state.selectedVersion==="final");
    const a=new Map((signals?.first?.items||[]).map(x=>[x.ticker,x]));
    const b=new Map((signals?.final?.items||[]).map(x=>[x.ticker,x]));
    const same=signals?.first?.week_ending&&signals?.final?.week_ending&&signals.first.week_ending===signals.final.week_ending;
    let ch=[];
    if(same)for(const[t,n]of ACTIVE12){if(a.get(t)&&b.get(t)&&Boolean(a.get(t).trend_on)!==Boolean(b.get(t).trend_on))ch.push(`${n}: ${a.get(t).trend_on?"ON":"OFF"} → ${b.get(t).trend_on?"ON":"OFF"}`)}
    $("#changeSummary").innerHTML=!same?"1차와 최종이 같은 완료주봉이면 변경사항을 비교합니다.":ch.length?`<span class="changed">변경 ${ch.length}건 · ${ch.join(" / ")}</span>`:`<span class="same">1차→최종 TREND ON/OFF 변경 없음</span>`;
  }

  function renderStale(){
    const v=getVersionData();
    const el=$("#staleBanner");
    if(!v?.generated_at){ el.classList.add("hidden"); return; }
    const age=(Date.now()-new Date(v.generated_at).getTime())/86400000;
    if(age>8){
      el.textContent=`주의: 선택한 신호가 ${Math.floor(age)}일 전 생성되었습니다. 매매 전에 최신 주간 데이터인지 확인하세요.`;
      el.classList.remove("hidden");
    } else el.classList.add("hidden");
  }

  function renderSummary(){
    const cc=confirmedCapital(), target=slotTarget(), cash=Number(state.cash||0);
    $("#confirmedCapital").textContent=moneyCompact(cc);
    $("#slotTarget").textContent=moneyCompact(target);
    $("#cashValue").textContent=moneyCompact(cash);
    $("#cashRatio").textContent=`확정자본 대비 ${cc>0?pct(cash/cc*100,1):"0.0%"}`;
    $("#slotCount").textContent=`${heldTickers().length} / ${MAX_SLOTS}`;
    $("#marketEquity").textContent=moneyCompact(marketEquity());
    const up=unrealizedPnl();
    $("#unrealizedPnl").textContent=`미실현 ${up>=0?"+":""}${moneyCompact(up)} · 슬롯 산정 제외`;
  }

  function trendStatus(item){
    if(!item) return {text:"데이터 없음", cls:"neutral"};
    if(item.exit_20w) return {text:"20주선 이탈",cls:"exit"};
    if(item.trend_on) return {text:"TREND ON",cls:"on"};
    return {text:"TREND OFF",cls:"off"};
  }

  function renderSignalTable(){
    const v=getVersionData();
    $("#signalAsOf").textContent=v?`${state.selectedVersion==="daily"?"오늘 17시":state.selectedVersion==="first"?"1차":"최종"} · ${v.week_ending||"—"}`:"데이터 없음";
    const cur=new Map((v?.items||[]).map(x=>[x.ticker,x]));
    const first=new Map((signals?.first?.items||[]).map(x=>[x.ticker,x]));
    const final=new Map((signals?.final?.items||[]).map(x=>[x.ticker,x]));
    const same=signals?.first?.week_ending&&signals?.final?.week_ending&&signals.first.week_ending===signals.final.week_ending;
    $("#signalTableBody").innerHTML=ACTIVE12.map(([t,n])=>{
      const x=cur.get(t);
      let st="TREND OFF",cls="off";
      if(x?.weekly_exit_confirmed){st="주봉 이탈 확정";cls="exit"}
      else if(x?.provisional_20w_below){st="주봉 잠정 이탈";cls="warn"}
      else if(x?.trend_on){st="TREND ON";cls="on"}
      const lots=activeLots().filter(l=>l.ticker===t),p=Number(x?.close);
      let dist=null;if(lots.length&&Number.isFinite(p))dist=Math.min(...lots.map(l=>(p/Number(l.stopPrice)-1)*100));
      const dc=dist===null?"":dist<=1?"danger":dist<=3?"near":"safe";
      let ch="—",cc="same";if(same&&first.get(t)&&final.get(t)){const a=!!first.get(t).trend_on,b=!!final.get(t).trend_on;ch=a===b?(a?"ON → ON":"OFF → OFF"):`${a?"ON":"OFF"} → ${b?"ON":"OFF"}`;if(a!==b)cc="changed"}
      return `<tr><td><div class="signal-name">${n}</div><div class="signal-code">${t}</div></td><td><span class="pill ${cls}">${st}</span></td><td class="num">${price(x?.close)}</td><td class="num">${price(x?.sma20d)}</td><td class="num">${price(x?.sma20w)}</td><td class="num stop-distance ${dc}">${dist===null?"—":pct(dist,1)}</td><td class="num">${one(x?.rsi)}</td><td class="num">${one(x?.strength)}</td><td>${x?(x.obv_ok?"OK":"NO"):"—"}</td><td>${x?(x.macd_ok?"OK":"NO"):"—"}</td><td class="${cc}">${ch}</td></tr>`;
    }).join("");
  }

  function generateActions(){
    const sm=signalMap();
    const held=heldTickers();
    const actions=[];

    for(const ticker of held){
      const x=sm.get(ticker);
      if(x?.exit_20w){
        actions.push({
          type:"sell", icon:"↓", title:`${itemName(ticker)} · 전량매도`,
          desc:`완료주봉 종가 ${price(x.close)} < 20주선 ${price(x.sma20w)} · 다음 실제 거래일 시가`,
          amount:money(openCostBasis(ticker))
        });
      }
    }

    let free=Math.max(0,MAX_SLOTS-held.length);
    if(free>0){
      const candidates=[...sm.values()]
        .filter(x=>x.trend_on && !held.includes(x.ticker))
        .sort((a,b)=>(Number(b.strength)||0)-(Number(a.strength)||0));

      let virtualCash=Number(state.cash||0);
      const target=slotTarget();
      for(const x of candidates){
        if(free<=0)break;
        if(virtualCash<=0){
          actions.push({
            type:"none",icon:"·",title:`${x.name} · TREND ON`,
            desc:"빈 슬롯은 있지만 현재 현금으로 1주 매수 가능 여부를 확인해야 합니다.",
            amount:"현금 부족"
          });
          break;
        }
        const alloc=Math.min(virtualCash,target);
        actions.push({
          type:"buy",icon:"+",title:`${x.name} · 신규 TREND`,
          desc:`목표 ${money(target)} · 현금 부족 시 부분진입 허용 · 최초 lot STOP -7.0%`,
          amount:`예정 ${money(alloc)}`
        });
        virtualCash-=alloc;
        free--;
      }
    }

    if(!actions.length){
      actions.push({
        type:"none",icon:"✓",title:"현재 즉시 실행할 주간 행동 없음",
        desc:"보유 lot의 장중 STOP과 다음 완료주봉을 확인하세요.",
        amount:"대기"
      });
    }
    return actions;
  }

  function renderActions(){
    $("#actionList").innerHTML=generateActions().map(a=>`
      <div class="action ${a.type}">
        <div class="action-icon">${a.icon}</div>
        <div><div class="action-title">${a.title}</div><div class="action-desc">${a.desc}</div></div>
        <div class="action-amount">${a.amount}</div>
      </div>`).join("");
  }

  function refillPlan(){
    const target=slotTarget(), cash=Math.max(0,Number(state.cash||0)), sm=signalMap();
    const rows=heldTickers().map(ticker=>{
      const x=sm.get(ticker);
      const cost=openCostBasis(ticker);
      const activeTrend = !x?.exit_20w; // 보유 TREND는 20주선 이탈 전까지 active
      const deficit=activeTrend ? Math.max(target-cost,0) : 0;
      return {ticker,name:itemName(ticker),cost,target,deficit,activeTrend};
    });
    const totalDef=rows.reduce((s,r)=>s+r.deficit,0);
    const deploy=Math.min(cash,totalDef);
    for(const r of rows){
      r.alloc=totalDef>0 ? Math.min(r.deficit,deploy*(r.deficit/totalDef)) : 0;
    }
    return {target,cash,totalDef,deploy,rows};
  }

  function renderRefill(){
    const p=refillPlan();
    const rows=p.rows.filter(r=>r.deficit>0 || !r.activeTrend);
    $("#refillPanel").innerHTML=`
      <div class="refill-summary">
        <div class="refill-item"><div class="k">슬롯 목표</div><div class="v">${money(p.target)}</div></div>
        <div class="refill-item"><div class="k">가용 현금</div><div class="v">${money(p.cash)}</div></div>
        <div class="refill-item"><div class="k">총 부족액</div><div class="v">${money(p.totalDef)}</div></div>
        <div class="refill-item"><div class="k">현재 배분 가능</div><div class="v">${money(p.deploy)}</div></div>
      </div>
      ${rows.length?`<div class="table-scroll"><table class="refill-table">
        <thead><tr><th>종목</th><th class="num">현재 원가</th><th class="num">부족액</th><th class="num">pro-rata 예정</th><th>상태</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
          <td>${r.name}</td><td class="num">${money(r.cost)}</td>
          <td class="num">${money(r.deficit)}</td><td class="num refill-value">${money(r.alloc)}</td>
          <td>${r.activeTrend?'<span class="pill on">보유 TREND</span>':'<span class="pill exit">20주선 이탈 · REFILL 금지</span>'}</td>
        </tr>`).join("")}</tbody>
      </table></div>`:`<div class="empty">현재 REFILL 부족분이 없습니다.</div>`}
      <div class="help">※ 실제 REFILL은 월 외부입금 반영 후 계산하고, 주문 체결 뒤 각 REFILL lot를 앱에 등록하세요. REFILL lot는 각각 -5.0% STOP입니다.</div>
    `;
  }

  function renderLots(){
    const sm=signalMap();
    const lots=activeLots().sort((a,b)=>String(b.buyDate).localeCompare(String(a.buyDate)));
    const target=slotTarget();

    if(!lots.length){
      $("#lotList").innerHTML=`<div class="empty">등록된 보유 lot가 없습니다. 실제 증권계좌 보유분을 먼저 등록하세요.</div>`;
      return;
    }

    $("#lotList").innerHTML=lots.map(l=>{
      const x=sm.get(l.ticker);
      const current=Number(x?.close);
      const mv=Number.isFinite(current)?current*Number(l.shares):NaN;
      const pnl=Number.isFinite(mv)?mv-Number(l.cost):NaN;
      const posCost=openCostBasis(l.ticker);
      const deficit=Math.max(target-posCost,0);
      return `<div class="lot">
        <div class="lot-top">
          <div>
            <div class="lot-name">${itemName(l.ticker)} <span class="pill ${l.source==="INITIAL"?"warn":"neutral"}">${l.source==="INITIAL"?"최초 -7%":"REFILL -5%"}</span></div>
            <div class="signal-code">${l.buyDate || "날짜 없음"} · ${Number(l.shares).toLocaleString("ko-KR")}주</div>
          </div>
          <div class="lot-actions">
            <button class="small-btn ghost" data-edit-lot="${l.id}">수정</button>
            <button class="small-btn danger-ghost" data-sell-lot="${l.id}">매도 입력</button>
          </div>
        </div>
        <div class="lot-grid">
          <div class="kv"><div class="k">매수가</div><div class="v">${price(l.buyPrice)}</div></div>
          <div class="kv"><div class="k">lot 원가</div><div class="v">${money(l.cost)}</div></div>
          <div class="kv"><div class="k">STOP</div><div class="v stop-value">${price(l.stopPrice)} (${pct(-Number(l.stopPct)*100,1)})</div></div>
          <div class="kv"><div class="k">주간 종가</div><div class="v">${price(current)}</div></div>
          <div class="kv"><div class="k">미실현</div><div class="v">${Number.isFinite(pnl)?`${pnl>=0?"+":""}${money(pnl)}`:"—"}</div></div>
          <div class="kv"><div class="k">종목 부족액</div><div class="v refill-value">${money(deficit)}</div></div>
        </div>
      </div>`;
    }).join("");

    $$("[data-sell-lot]").forEach(b=>b.onclick=()=>openSellDialog(b.dataset.sellLot));
    $$("[data-edit-lot]").forEach(b=>b.onclick=()=>openLotDialog(b.dataset.editLot));
  }

  function renderLedger(){
    const rows=state.ledger || [];
    $("#ledgerBody").innerHTML=rows.length?rows.map(r=>`
      <tr>
        <td>${dateTimeKST(r.at)}</td>
        <td>${r.type}</td>
        <td>${r.description}</td>
        <td class="num">${r.amount>=0?"+":""}${money(r.amount)}</td>
      </tr>`).join(""):`<tr><td colspan="4" class="empty">원장 기록이 없습니다.</td></tr>`;
  }


  function refillExecutable(){
    if(!state.lastContributionAt)return false;
    const d=new Date(state.lastContributionAt),n=new Date();
    return d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth();
  }
  function renderHero(){
    const daily=new Map((getVersionData("daily")?.items||[]).map(x=>[x.ticker,x]));
    const health=getVersionData("daily")?.items?.length||0;
    let hard=0,exit=0,prov=0;
    for(const l of activeLots()){const p=Number(daily.get(l.ticker)?.close);if(Number.isFinite(p)&&p<=Number(l.stopPrice))hard++}
    for(const t of heldTickers()){const x=daily.get(t);if(x?.weekly_exit_confirmed)exit++;else if(x?.provisional_20w_below)prov++}
    const buys=generateActions().filter(a=>a.type==="buy").length;
    const refills=refillExecutable()?refillPlan().rows.filter(r=>r.alloc>0).length:0;
    $("#heroHardStop").textContent=`${hard}건`;$("#heroWeeklyExit").textContent=`${exit}건`;$("#heroNewBuy").textContent=`${buys}건`;$("#heroRefill").textContent=`${refills}건`;$("#heroProvisional").textContent=`${prov}건`;
    $("#dataHealthPill").className=`pill ${health===12?"on":"warn"}`;$("#dataHealthPill").textContent=health===12?"ACTIVE12 12/12 정상 ✓":`${health}/12 ⚠️ 신규매수 판단 금지`;
    $("#dailyStatusTime").textContent=getVersionData("daily")?.generated_at?`${dateTimeKST(getVersionData("daily").generated_at)} 기준`:"오늘 17시 상태 미생성";
    $("#lastBackupText").textContent=state.lastBackupAt?dateTimeKST(state.lastBackupAt):"없음";
    const n=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Seoul"})),wd=n.getDay(),hr=n.getHours();
    $("#nextCheckText").textContent=wd===5&&hr>=17?"토요일 10:00 KST · 주간 최종":wd===6&&hr<10?"오늘 토요일 10:00 KST · 주간 최종":"다음 매일 17:00 KST 상태";
  }

  function render(){
    renderHero();
    if(state.selectedVersion==="daily" && !signals?.daily?.items?.length && signals?.final?.items?.length){
      state.selectedVersion="final"; saveState();
    }
    renderVersionCards();
    renderStale();
    renderSummary();
    renderActions();
    renderRefill();
    renderSignalTable();
    renderLots();
    renderLedger();
  }

  function openDialog(title, html, onConfirm){
    $("#dialogTitle").textContent=title;
    $("#dialogBody").innerHTML=html;
    const dlg=$("#genericDialog");
    const form=$("#dialogForm");
    const handler=(e)=>{
      if(e.submitter?.value==="default"){
        e.preventDefault();
        const ok=onConfirm(new FormData(form));
        if(ok!==false) dlg.close();
      }
    };
    form.onsubmit=handler;
    dlg.showModal();
  }

  function tickerOptions(selected=""){
    return ACTIVE12.map(([t,n])=>`<option value="${t}" ${t===selected?"selected":""}>${n}</option>`).join("");
  }

  function openContributionDialog(){
    openDialog("월 외부입금",`
      <div class="field"><label>입금액</label><input name="amount" type="number" min="0" step="1" required placeholder="1500000"></div>
      <div class="field"><label>메모</label><input name="memo" value="월 외부입금"></div>
      <div class="help">입금액은 현금과 확정기준자본에 즉시 반영됩니다. 이후 REFILL 계산이 새 목표 슬롯으로 갱신됩니다.</div>
    `,fd=>{
      const amount=Number(fd.get("amount"));
      if(!(amount>0))return false;
      state.cash=Number(state.cash||0)+amount;
      state.lastContributionAt=new Date().toISOString();
      addLedger("CONTRIBUTION",String(fd.get("memo")||"월 외부입금"),amount);
      saveState(); render(); showMessage("월입금을 반영하고 REFILL을 다시 계산했습니다.","good",2200);
    });
  }

  function openCashAdjustDialog(){
    openDialog("현금 잔액 맞추기",`
      <div class="field"><label>증권계좌 실제 현금 잔액</label><input name="cash" type="number" min="0" step="1" required value="${Math.round(Number(state.cash||0))}"></div>
      <div class="help">증권계좌를 source of truth로 하여 앱 현금만 맞춥니다. 차액은 원장에 '현금 조정'으로 남습니다.</div>
    `,fd=>{
      const v=Number(fd.get("cash"));
      if(v<0 || !Number.isFinite(v))return false;
      const delta=v-Number(state.cash||0);
      state.cash=v;
      addLedger("CASH_ADJUST","증권계좌 현금 잔액 맞춤",delta);
      saveState();render();
    });
  }

  function openLotDialog(editId=null){
    const old=editId?state.lots.find(x=>x.id===editId):null;
    openDialog(old?"보유 lot 수정":"보유 lot 등록",`
      <div class="field"><label>종목</label><select name="ticker">${tickerOptions(old?.ticker)}</select></div>
      <div class="form-grid">
        <div class="field"><label>구분</label><select name="source">
          <option value="INITIAL" ${old?.source!=="REFILL"?"selected":""}>최초 TREND (-7%)</option>
          <option value="REFILL" ${old?.source==="REFILL"?"selected":""}>월 REFILL (-5%)</option>
        </select></div>
        <div class="field"><label>매수일</label><input name="buyDate" type="date" required value="${old?.buyDate||new Date().toISOString().slice(0,10)}"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>수량(주)</label><input name="shares" type="number" min="0.000001" step="0.000001" required value="${old?.shares||""}"></div>
        <div class="field"><label>실제 체결 단가</label><input name="buyPrice" type="number" min="0" step="1" required value="${old?.buyPrice||""}"></div>
      </div>
      <div class="field"><label>실제 총 매입원가(수수료 포함, 선택)</label><input name="cost" type="number" min="0" step="1" value="${old?.cost||""}" placeholder="비우면 수량×체결가"></div>
      <div class="field"><label><input name="affectCash" type="checkbox" ${old?"":"checked"}> 현금에서도 매입원가 차감</label></div>
      <div class="help">기존 보유분을 처음 앱에 등록하면서 이미 현금잔액을 별도로 맞췄다면 '현금 차감' 체크를 해제하세요.</div>
    `,fd=>{
      const ticker=String(fd.get("ticker"));
      const source=String(fd.get("source"));
      const shares=Number(fd.get("shares")), buyPrice=Number(fd.get("buyPrice"));
      const given=Number(fd.get("cost"));
      const cost=given>0?given:shares*buyPrice;
      if(!(shares>0 && buyPrice>0 && cost>0))return false;
      const stopPct=source==="INITIAL"?0.07:0.05;
      const lot={
        id:old?.id||uid("lot"), ticker, source, buyDate:String(fd.get("buyDate")),
        shares,buyPrice,cost,stopPct,stopPrice:buyPrice*(1-stopPct),active:true
      };
      if(old){
        const idx=state.lots.findIndex(x=>x.id===old.id);
        state.lots[idx]=lot;
        addLedger("LOT_EDIT",`${itemName(ticker)} lot 수정`,0);
      }else{
        state.lots.push(lot);
        if(fd.get("affectCash")==="on") state.cash=Number(state.cash||0)-cost;
        addLedger("BUY",`${itemName(ticker)} ${source==="INITIAL"?"최초 TREND":"REFILL"} ${shares}주`,-cost,{lotId:lot.id});
      }
      saveState();render();
    });
  }

  function openSellDialog(lotId){
    const lot=state.lots.find(x=>x.id===lotId && x.active!==false);
    if(!lot)return;
    openDialog(`${itemName(lot.ticker)} lot 매도`,`
      <div class="field"><label>매도 사유</label><select name="reason">
        <option value="HARD_STOP">${lot.source==="INITIAL"?"-7% 최초 hard stop":"-5% REFILL hard stop"}</option>
        <option value="SMA20_EXIT">완료주봉 20주선 이탈</option>
        <option value="BROKER_SYNC">기타 / 증권계좌 동기화</option>
      </select></div>
      <div class="field"><label>실제 총 매도대금(수수료·세금 반영 후)</label><input name="proceeds" type="number" min="0" step="1" required></div>
      <div class="help">lot 전체 매도를 기준으로 합니다. 갭 stop이면 -7%/-5%보다 불리한 실제 체결대금을 입력하세요.</div>
    `,fd=>{
      const proceeds=Number(fd.get("proceeds"));
      if(!(proceeds>=0))return false;
      lot.active=false;
      lot.sellDate=new Date().toISOString().slice(0,10);
      lot.sellReason=String(fd.get("reason"));
      lot.proceeds=proceeds;
      lot.realizedPnl=proceeds-Number(lot.cost||0);
      state.cash=Number(state.cash||0)+proceeds;
      addLedger("SELL",`${itemName(lot.ticker)} ${lot.sellReason} · 실현 ${lot.realizedPnl>=0?"+":""}${money(lot.realizedPnl)}`,proceeds,{lotId:lot.id});
      saveState();render();
    });
  }

  function backup(){
    state.lastBackupAt=new Date().toISOString(); saveState();
    const payload={
      app:"ETF_TREND_LIVE_V1",
      exportedAt:new Date().toISOString(),
      state,
      signals
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`ETF_TREND_LIVE_BACKUP_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  async function restore(file){
    try{
      const data=JSON.parse(await file.text());
      if(data.state)state={...defaultState(),...data.state};
      else if(data.cash!==undefined)state={...defaultState(),...data};
      if(data.signals)signals=data.signals;
      saveState();
      if(signals)localStorage.setItem(SIGNAL_CACHE_KEY,JSON.stringify(signals));
      render();showMessage("백업을 복원했습니다.","good",2200);
    }catch(e){
      showMessage(`복원 실패: ${e.message}`,"bad");
    }
  }

  function clearLedger(){
    if(!confirm("거래 원장만 초기화할까요? 보유 lot와 현금은 유지됩니다."))return;
    state.ledger=[];saveState();render();
  }

  $("#dailyVersionBtn").onclick=()=>{state.selectedVersion="daily";saveState();render();};
  $("#firstVersionBtn").onclick=()=>{state.selectedVersion="first";saveState();render();};
  $("#finalVersionBtn").onclick=()=>{state.selectedVersion="final";saveState();render();};
  $("#refreshBtn").onclick=()=>loadSignals(true);
  $("#backupBtn").onclick=backup;
  $("#restoreInput").onchange=e=>e.target.files?.[0] && restore(e.target.files[0]);
  $("#contributionBtn").onclick=openContributionDialog;
  $("#cashAdjustBtn").onclick=openCashAdjustDialog;
  $("#addLotBtn").onclick=()=>openLotDialog();
  $("#refillCalcBtn").onclick=()=>{renderRefill();showMessage("현재 현금·원가 기준으로 REFILL을 다시 계산했습니다.","good",1600);};
  $("#clearLedgerBtn").onclick=clearLedger;

  if("serviceWorker" in navigator){
    window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  }

  loadSignals(false);
})();
