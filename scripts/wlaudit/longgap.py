import os, json, urllib.request, urllib.parse, time, datetime, hashlib
import base58
TK=os.environ["TRONGRID_API_KEY"]

def tron_events_all(addr, name, min_ts=None, max_ts=None):
    out=[]; fp=None
    while True:
        p={"event_name":name,"limit":"200","order_by":"block_timestamp,asc"}
        if min_ts is not None: p["min_block_timestamp"]=str(min_ts)
        if max_ts is not None: p["max_block_timestamp"]=str(max_ts)
        if fp: p["fingerprint"]=fp
        url=f"https://api.trongrid.io/v1/contracts/{addr}/events?"+urllib.parse.urlencode(p)
        req=urllib.request.Request(url, headers={"TRON-PRO-API-KEY":TK})
        with urllib.request.urlopen(req,timeout=35) as r:
            d=json.loads(r.read().decode())
        out.extend(d.get("data",[]))
        fp=(d.get("meta") or {}).get("fingerprint")
        if not fp: break
        time.sleep(0.08)
    return out

def to_b58(hex20):
    raw = bytes.fromhex("41" + hex20[2:])
    cs = hashlib.sha256(hashlib.sha256(raw).digest()).digest()[:4]
    return base58.b58encode(raw+cs).decode()

TRON_USDT="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
now_ms=int(time.time()*1000)
start_ms=now_ms - 30*86400*1000

# 1. last-30d DestroyedBlackFunds on Tron USDT
destroys=tron_events_all(TRON_USDT,"DestroyedBlackFunds",min_ts=start_ms)
print(f"Tron USDT DestroyedBlackFunds 30d: {len(destroys)}")

# 2. all-time AddedBlackList: build earliest-ts map
adds=tron_events_all(TRON_USDT,"AddedBlackList")
print(f"Tron USDT AddedBlackList all-time: {len(adds)}")
earliest={}
for e in adds:
    res=e.get("result") or {}
    u=res.get("_user") or res.get("0")
    ts=e.get("block_timestamp")
    if not u or ts is None: continue
    if u not in earliest or ts < earliest[u]["ts"]:
        earliest[u]={"ts":ts,"tx":e.get("transaction_id"),"block":e.get("block_number"),"event_index":e.get("event_index")}
print(f"distinct freeze-added addresses: {len(earliest)}")

# 3. For each destroy, find its freeze → gap
pairs=[]
for e in destroys:
    res=e.get("result") or {}
    u=res.get("_blackListedUser") or res.get("_user") or res.get("0")
    if not u: continue
    freeze = earliest.get(u)
    if not freeze:
        continue  # destroyed without a recorded freeze (shouldn't happen)
    destroy_ts=e.get("block_timestamp")
    gap_ms = destroy_ts - freeze["ts"]
    pairs.append({
        "wallet_hex": u,
        "wallet_base58": to_b58(u),
        "freeze_tx": freeze["tx"], "freeze_block": freeze["block"], "freeze_ts_ms": freeze["ts"],
        "destroy_tx": e.get("transaction_id"), "destroy_block": e.get("block_number"), "destroy_ts_ms": destroy_ts,
        "destroy_event_index": e.get("event_index"),
        "gap_ms": gap_ms, "gap_days": round(gap_ms/86400000, 1),
    })
pairs.sort(key=lambda x: -x["gap_ms"])
print(f"\npaired destroy+freeze records: {len(pairs)}")
print(f"\nTop 5 longest gaps:")
for p in pairs[:5]:
    print(f"  wallet={p['wallet_base58']}  gap={p['gap_days']}d  freeze@{datetime.datetime.utcfromtimestamp(p['freeze_ts_ms']/1000).date()}  destroy@{datetime.datetime.utcfromtimestamp(p['destroy_ts_ms']/1000).date()}")

best=pairs[0] if pairs else None
if best:
    print(f"\nPicked wallet (longest gap):")
    print(json.dumps(best,indent=2))

# Write to evidence
json.dump({
    "generated_at_utc": datetime.datetime.utcnow().isoformat()+"Z",
    "method":"TronGrid v1/contracts/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t/events for AddedBlackList (all-time) + DestroyedBlackFunds (30d); pair by wallet; gap = destroy_ts - earliest_freeze_ts.",
    "n_destroys_30d": len(destroys),
    "n_adds_all_time": len(adds),
    "n_paired": len(pairs),
    "longest_gap_pair": best,
    "top5_longest": pairs[:5],
},open("/tmp/wlaudit/longgap.json","w"), indent=2)
print("\nwrote /tmp/wlaudit/longgap.json")
