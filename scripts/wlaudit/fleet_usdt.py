import os, json, urllib.request, urllib.parse, time, datetime, hashlib
import base58
from Crypto.Hash import keccak
EK=os.environ["ETHERSCAN_API_KEY"]; TK=os.environ["TRONGRID_API_KEY"]
def kk(s): k=keccak.new(digest_bits=256); k.update(s.encode()); return "0x"+k.hexdigest()
def eget(p):
    p={**p,"apikey":EK,"chainid":1}
    with urllib.request.urlopen("https://api.etherscan.io/v2/api?"+urllib.parse.urlencode(p),timeout=45) as r:
        return json.loads(r.read().decode())
def thr(): time.sleep(0.4)

def _h(v):
    if not v or v=="0x": return 0
    try: return int(v,16)
    except: return 0

def eth_usdt_map():
    addr="0xdAC17F958D2ee523a2206206994597C13D831ec7"
    head=int(eget({"module":"proxy","action":"eth_blockNumber"})["result"],16); thr()
    t0=kk("AddedBlackList(address)")
    out=[]; page=1
    while True:
        r=eget({"module":"logs","action":"getLogs","address":addr,
                "fromBlock":"4634748","toBlock":str(head),
                "topic0":t0,"page":str(page),"offset":"1000"}); thr()
        if isinstance(r.get("result"),str): break
        ch=r.get("result",[]); out.extend(ch)
        if len(ch)<1000 or page>=10: break
        page+=1
    print(f"ETH USDT: fetched {len(out)} AddedBlackList events")
    m={}
    for l in out:
        data=l.get("data","")
        if not data or len(data)<66: continue
        w="0x"+data[2:66][-40:].lower()
        ts=_h(l.get("timeStamp","")); blk=_h(l.get("blockNumber",""))
        rec={"tx":l["transactionHash"],"block":blk,"ts_unix":ts,"log_index":_h(l.get("logIndex",""))}
        if w not in m or rec["ts_unix"]<m[w]["ts_unix"] or (rec["ts_unix"]==m[w]["ts_unix"] and rec["block"]<m[w]["block"]):
            m[w]=rec
    return m

def tron_usdt_map():
    addr="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
    out=[]; fp=None; pages=0
    while True:
        p={"event_name":"AddedBlackList","limit":"200","order_by":"block_timestamp,asc"}
        if fp: p["fingerprint"]=fp
        req=urllib.request.Request(f"https://api.trongrid.io/v1/contracts/{addr}/events?"+urllib.parse.urlencode(p),
                                   headers={"TRON-PRO-API-KEY":TK})
        with urllib.request.urlopen(req,timeout=40) as r:
            d=json.loads(r.read().decode())
        out.extend(d.get("data",[]))
        fp=(d.get("meta") or {}).get("fingerprint")
        pages+=1
        if not fp: break
        time.sleep(0.08)
    print(f"Tron USDT: fetched {len(out)} AddedBlackList events across {pages} pages")
    m={}
    for e in out:
        res=e.get("result") or {}
        u=res.get("_user") or res.get("0")
        if not u: continue
        ts=e.get("block_timestamp")
        rec={"tx":e.get("transaction_id"),"block":e.get("block_number"),"ts_ms":ts,"event_index":e.get("event_index")}
        if u not in m or rec["ts_ms"]<m[u]["ts_ms"]:
            m[u]=rec
    return m

def to_b58(hex20):
    raw=bytes.fromhex("41"+hex20[2:])
    cs=hashlib.sha256(hashlib.sha256(raw).digest()).digest()[:4]
    return base58.b58encode(raw+cs).decode()

def is_sentinel(a): return a.startswith("0x") and a[2:22]=="0"*20

cen=json.load(open("docs/evidence/watchlist-30d-counts.json"))["census"]
eth_cf=[a.lower() for a in cen["ETH_USDT"]["addresses"]["currently_frozen"]]
tron_cf=[a.lower() for a in cen["TRON_USDT"]["addresses"]["currently_frozen"]]
eth_at_set={a.lower() for a in cen["ETH_USDT"]["addresses"]["all_time_added"]}
tron_at_set={a.lower() for a in cen["TRON_USDT"]["addresses"]["all_time_added"]}
print(f"census currently_frozen: eth_usdt={len(eth_cf)} tron_usdt={len(tron_cf)}")
eth_fleet=[a for a in eth_cf if not is_sentinel(a)]
tron_fleet=[a for a in tron_cf if not is_sentinel(a)]
print(f"after sentinel filter:   eth_usdt={len(eth_fleet)} tron_usdt={len(tron_fleet)}  total={len(eth_fleet)+len(tron_fleet)}")

print("\nbuilding ETH USDT earliest-freeze map...")
e_map=eth_usdt_map()
print(f"  distinct wallets with freeze record: {len(e_map)}")

print("\nbuilding Tron USDT earliest-freeze map...")
t_map=tron_usdt_map()
print(f"  distinct wallets with freeze record: {len(t_map)}")

rows=[]; unresolved=[]
for a in eth_fleet:
    rec=e_map.get(a)
    if rec and rec["ts_unix"]:
        rows.append({
            "source_contract":"ETH_USDT","chain":"eth","address":a,
            "freeze_tx":rec["tx"],"freeze_block":rec["block"],
            "frozen_at":datetime.datetime.utcfromtimestamp(rec["ts_unix"]).isoformat()+"Z",
        })
    else:
        if rec is None:
            reason = "map_miss_despite_being_in_census_added" if a in eth_at_set else "not_in_all_time_added"
        else:
            reason = "log_returned_without_timestamp"
        unresolved.append({"source_contract":"ETH_USDT","address":a,"reason":reason})

for a in tron_fleet:
    rec=t_map.get(a)
    if rec and rec["ts_ms"]:
        rows.append({
            "source_contract":"TRON_USDT","chain":"tron","address":a,
            "tron_base58":to_b58(a),
            "freeze_tx":rec["tx"],"freeze_block":rec["block"],
            "frozen_at":datetime.datetime.utcfromtimestamp(rec["ts_ms"]/1000).isoformat()+"Z",
        })
    else:
        if rec is None:
            reason = "map_miss_despite_being_in_census_added" if a in tron_at_set else "not_in_all_time_added"
        else:
            reason = "tron_event_missing_block_timestamp"
        unresolved.append({"source_contract":"TRON_USDT","address":a,
                           "tron_base58":to_b58(a) if a.startswith("0x") else None,
                           "reason":reason})

expected=len(eth_fleet)+len(tron_fleet)
resolved=len(rows)
print(f"\nresolved: {resolved} / {expected}")
print(f"unresolved: {len(unresolved)}")
by_reason={}
for u in unresolved: by_reason[u["reason"]]=by_reason.get(u["reason"],0)+1
if by_reason:
    print(f"  by reason: {by_reason}")
    print("  samples:")
    for u in unresolved[:5]: print(f"   {u}")

dates=[r["frozen_at"][:10] for r in rows]
print(f"\nfrozen_at range: {min(dates) if dates else 'n/a'} .. {max(dates) if dates else 'n/a'}")

out={
    "generated_at_utc": datetime.datetime.utcnow().isoformat()+"Z",
    "purpose":"Full USDT dormant fleet (ETH USDT + Tron USDT currently_frozen) enriched with freeze_tx/block/frozen_at for mode B registration. Sentinels excluded per watchlist-audit §3.",
    "source_census":"docs/evidence/watchlist-30d-counts.json",
    "sentinel_rule":"address[2:22] == \"0\"*20 (first 10 bytes of the body zero).",
    "method":"Full-history paginated event scan: Etherscan V2 logs/getLogs on ETH USDT for AddedBlackList(address) (non-indexed, data word 0); TronGrid v1/contracts/{addr}/events for Tron USDT AddedBlackList (ABI-named _user). Wallet-indexed; earliest timestamp kept.",
    "expected_counts": {"eth_usdt_currently_frozen_minus_sentinels": len(eth_fleet),
                        "tron_usdt_currently_frozen_minus_sentinels": len(tron_fleet),
                        "total_expected": expected},
    "resolved_count": resolved,
    "unresolved_count": len(unresolved),
    "unresolved": unresolved,
    "rows": rows,
}
with open("docs/evidence/dormant-fleet-usdt-enriched.json","w") as f:
    json.dump(out,f,indent=2)
print(f"\nwrote docs/evidence/dormant-fleet-usdt-enriched.json bytes={os.path.getsize('docs/evidence/dormant-fleet-usdt-enriched.json')}")
