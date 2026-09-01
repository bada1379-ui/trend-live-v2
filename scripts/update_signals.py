#!/usr/bin/env python3
from __future__ import annotations
import argparse
import json
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

UNIVERSE = {
    "069500.KS":"KODEX 200",
    "229200.KS":"KODEX 코스닥150",
    "133690.KS":"TIGER 미국나스닥100",
    "360750.KS":"TIGER 미국S&P500",
    "245340.KS":"TIGER 미국다우존스30",
    "466920.KS":"SOL 조선TOP3플러스",
    "449450.KS":"PLUS K방산",
    "487240.KS":"KODEX AI전력핵심설비",
    "305540.KS":"TIGER 2차전지테마",
    "139260.KS":"TIGER 200 IT",
    "157500.KS":"TIGER 200 증권",
    "091180.KS":"KODEX 자동차",
}

KST = ZoneInfo("Asia/Seoul")
OUT = Path(__file__).resolve().parents[1] / "data" / "signals.json"

def clean(df):
    if df is None or len(df)==0:
        return pd.DataFrame()
    x=df.copy()
    if isinstance(x.columns,pd.MultiIndex):
        x.columns=x.columns.get_level_values(0)
    ren={"시가":"Open","고가":"High","저가":"Low","종가":"Close","거래량":"Volume"}
    x=x.rename(columns=ren)
    cols=["Open","High","Low","Close","Volume"]
    if not all(c in x.columns for c in cols):
        return pd.DataFrame()
    x=x[cols].apply(pd.to_numeric,errors="coerce")
    x.index=pd.to_datetime(x.index).tz_localize(None)
    return x.dropna(subset=["Open","High","Low","Close"]).sort_index()

def fetch(ticker):
    code=ticker.split(".")[0]
    start="2008-01-01"
    end=(datetime.now(KST)+timedelta(days=1)).date().isoformat()

    try:
        import FinanceDataReader as fdr
        d=clean(fdr.DataReader(code,start,end))
        if len(d)>=80:
            return d,"fdr_naver"
    except Exception:
        pass

    try:
        import yfinance as yf
        d=clean(yf.download(
            ticker,start=start,end=end,auto_adjust=True,actions=False,
            progress=False,threads=False
        ))
        if len(d)>=80:
            return d,"yfinance"
    except Exception:
        pass

    raise RuntimeError(f"{ticker}: 데이터 수집 실패")

def last_completed_friday(now):
    d=now.date()
    wd=now.weekday()  # Mon=0
    days_since_friday=(wd-4)%7
    friday=d-timedelta(days=days_since_friday)
    if wd==4 and now.hour<16:
        friday-=timedelta(days=7)
    return pd.Timestamp(friday)

def rsi_sma(close,window=14):
    delta=close.diff()
    gain=delta.clip(lower=0.0)
    loss=(-delta.clip(upper=0.0))
    ag=gain.rolling(window).mean()
    al=loss.rolling(window).mean()
    rs=ag/(al+1e-12)
    return 100-100/(1+rs)

def indicators(daily,cutoff):
    d=daily.loc[daily.index<=cutoff].copy()
    if len(d)<80:
        raise RuntimeError("daily bars 부족")

    d["SMA20D"]=d["Close"].rolling(20).mean()

    w=d.resample("W-FRI",label="right",closed="right").agg({
        "Open":"first","High":"max","Low":"min","Close":"last","Volume":"sum"
    }).dropna(subset=["Open","High","Low","Close"])
    w=w.loc[w.index<=cutoff].copy()

    w["SMA20"]=w["Close"].rolling(20).mean()
    w["RSI"]=rsi_sma(w["Close"],14)
    direction=np.sign(w["Close"].diff()).fillna(0.0)
    w["OBV"]=(direction*w["Volume"].fillna(0.0)).cumsum()
    w["OBV_Signal"]=w["OBV"].rolling(9).mean()
    ef=w["Close"].ewm(span=12,adjust=False).mean()
    es=w["Close"].ewm(span=26,adjust=False).mean()
    w["MACD"]=ef-es
    w["MACD_Signal"]=w["MACD"].ewm(span=9,adjust=False).mean()
    w["MACD_Hist"]=w["MACD"]-w["MACD_Signal"]

    if len(w)<30:
        raise RuntimeError("weekly bars 부족")
    c=w.iloc[-1]
    needed=["SMA20","RSI","OBV_Signal","MACD","MACD_Signal"]
    if any(pd.isna(c[k]) for k in needed):
        raise RuntimeError("indicator NaN")

    obv_ok=bool(c.OBV>=c.OBV_Signal)
    macd_ok=bool((c.MACD>=c.MACD_Signal) or (c.MACD>0))
    trend_on=bool(c.Close>c.SMA20 and obv_ok and macd_ok)
    exit_20w=bool(c.Close<c.SMA20)

    dist=max((float(c.Close)/float(c.SMA20)-1)*100,0.0)
    hist=max(float(c.MACD_Hist)/max(abs(float(c.Close)),1e-12)*100,0.0)
    strength=float(dist+hist)

    last_daily=d.iloc[-1]
    return {
        "week_ending":str(w.index[-1].date()),
        "close":float(c.Close),
        "sma20d":float(last_daily.SMA20D) if pd.notna(last_daily.SMA20D) else None,
        "sma20w":float(c.SMA20),
        "rsi":float(c.RSI),
        "strength":strength,
        "obv_ok":obv_ok,
        "macd_ok":macd_ok,
        "trend_on":trend_on,
        "exit_20w":exit_20w,
        "weekly_exit_confirmed":exit_20w,
        "provisional_20w_below":bool(float(last_daily.Close) < float(c.SMA20)),
        "macd":float(c.MACD),
        "macd_signal":float(c.MACD_Signal),
        "obv":float(c.OBV),
        "obv_signal":float(c.OBV_Signal),
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--version",choices=["daily","first","final"],required=True)
    args=ap.parse_args()

    now=datetime.now(KST)
    cutoff=last_completed_friday(now)

    items=[]
    week_ending=None
    errors=[]

    for ticker,name in UNIVERSE.items():
        try:
            daily,source=fetch(ticker)
            z=indicators(daily,cutoff)
            week_ending=week_ending or z["week_ending"]
            items.append({
                "ticker":ticker,"name":name,"source":source,**z
            })
            print(f"OK {name}: {z['week_ending']} trend={z['trend_on']}")
        except Exception as e:
            errors.append(f"{ticker} {name}: {e}")
            print("ERROR",errors[-1])

    if len(items)!=12:
        raise RuntimeError("12/12 데이터가 아니므로 signals.json을 갱신하지 않습니다.\n"+"\n".join(errors))

    payload={
        "generated_at":now.isoformat(),
        "week_ending":week_ending,
        "version":args.version,
        "label":{"daily":"오늘 상태 · 매일 17:00 KST","first":"1차 · 금요일 17:00 KST","final":"최종 · 토요일 10:00 KST"}[args.version],
        "items":items
    }

    if OUT.exists():
        root=json.loads(OUT.read_text(encoding="utf-8"))
    else:
        root={
          "schema":1,
          "strategy":"REALIZED6_REFILL / INITIAL -7% / REFILL -5%",
          "timezone":"Asia/Seoul",
          "schedule":{"daily":"Daily 17:00 KST","first":"Friday 17:00 KST","final":"Saturday 10:00 KST"},
          "daily":None,"first":None,"final":None,"universe_count":12
        }

    if args.version=="first":
        old_final=root.get("final")
        if old_final and old_final.get("week_ending")!=week_ending:
            root["final"]=None

    root[args.version]=payload
    root["updated_at"]=now.isoformat()
    OUT.write_text(json.dumps(root,ensure_ascii=False,indent=2),encoding="utf-8")
    print("WROTE",OUT)

if __name__=="__main__":
    main()
