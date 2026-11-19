import os, json, urllib.request, urllib.parse, time, datetime, sys
from Crypto.Hash import keccak

EK = os.environ["ETHERSCAN_API_KEY"]
TK = os.environ["TRONGRID_API_KEY"]

ETH_CALLS = 0
TRON_CALLS = 0
ETH_CEILING = 2000

def topic(sig):
    k=keccak.new(digest_bits=256); k.update(sig.encode()); return "0x" + k.hexdigest()

def egetj(params):
    global ETH_CALLS
    if ETH_CALLS >= ETH_CEILING:
        raise RuntimeError(f"Etherscan ceiling {ETH_CEILING} reached")
    ETH_CALLS += 1
    params = {**params, "apikey": EK, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=40) as r:
        return json.loads(r.read().decode())

def throttle(): time.sleep(0.4)  # ~2.5 rps

def addr_from_log(log):
    # Return lowercased 0x-address from an indexed topic or data field
    tops = log.get("topics", [])
    if len(tops) >= 2 and tops[1] and len(tops[1]) >= 42:
        return "0x" + tops[1][-40:].lower()
    data = log.get("data","")
    if data and data.startswith("0x") and len(data) >= 66:
        return "0x" + data[2:66][-40:].lower()
    return None

def eth_getlogs_range(address, topic0, from_block, to_block):
    """Fetch all logs in [from_block,to_block], auto-bisect if a single
    query returns the 1000 cap (indicating clipping)."""
    out = []
    stack = [(from_block, to_block)]
    while stack:
        a, b = stack.pop()
        page = 1
        chunk_total_this_range = 0
        while True:
            params = {"module":"logs","action":"getLogs","address":address,
                      "fromBlock":str(a),"toBlock":str(b),
                      "topic0":topic0,"page":str(page),"offset":"1000"}
            r = egetj(params); throttle()
            if isinstance(r.get("result"), str):
                msg = r.get("message","")
                if msg == "No records found" or r.get("status")=="0":
                    break
                # Range too big — bisect
                if "Result window is too large" in (r.get("result") or "") or "window" in (r.get("result") or "").lower():
                    mid = (a+b)//2
                    stack.append((a, mid)); stack.append((mid+1, b))
                    break
                raise RuntimeError(f"etherscan err a={a} b={b}: {r}")
            chunk = r.get("result",[])
            out.extend(chunk)
            chunk_total_this_range += len(chunk)
            if len(chunk) < 1000: break
            # If exactly 1000, might still be more — advance page. But Etherscan caps at 10000 for free tier.
            # To avoid loss, if page*1000 looks capped, bisect the range.
            if page >= 10:
                # bisect remaining
                mid = (a+b)//2
                stack.append((a, mid)); stack.append((mid+1, b))
                break
            page += 1
    return out

def trongrid_events(address_base58, event_name, min_ts_ms=None, max_ts_ms=None, limit=200):
    global TRON_CALLS
    out = []
    fingerprint = None
    while True:
        url = f"https://api.trongrid.io/v1/contracts/{address_base58}/events"
        params = {"event_name":event_name,"limit":str(limit),"order_by":"block_timestamp,asc"}
        if min_ts_ms is not None: params["min_block_timestamp"]=str(min_ts_ms)
        if max_ts_ms is not None: params["max_block_timestamp"]=str(max_ts_ms)
        if fingerprint: params["fingerprint"]=fingerprint
        req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params),
                                     headers={"TRON-PRO-API-KEY": TK})
        TRON_CALLS += 1
        with urllib.request.urlopen(req, timeout=45) as r:
            d = json.loads(r.read().decode())
        chunk = d.get("data",[])
        out.extend(chunk)
        meta = d.get("meta") or {}
        fingerprint = meta.get("fingerprint")
        if not fingerprint or len(chunk)==0: break
        time.sleep(0.1)
    return out

def tron_addr_from_event(evt):
    # TronGrid auto-decodes events using the contract ABI; result dict holds named params.
    result = evt.get("result") or {}
    for k,v in result.items():
        if isinstance(v,str) and len(v) in (34,42):
            # Tron base58 addr starts with 'T' and is 34 chars; also may return hex 0x-form 42 chars
            if v.startswith("T") and len(v)==34: return v
            if v.startswith("0x") and len(v)==42: return v.lower()
            if v.startswith("41") and len(v)==42: return v.lower()
    return None

def dedup_eth(logs):
    seen = set()
    addrs = []
    rows = []
    for l in logs:
        tx = l.get("transactionHash")
        idx = l.get("logIndex")
        key = (tx, idx)
        if key in seen: continue
        seen.add(key)
        a = addr_from_log(l)
        if a:
            addrs.append(a)
            rows.append({"tx":tx,"logIndex":idx,"block":int(l.get("blockNumber","0x0"),16) if l.get("blockNumber","").startswith("0x") else l.get("blockNumber"),"addr":a})
    return rows

def dedup_tron(events):
    seen = set()
    rows = []
    for e in events:
        key = (e.get("transaction_id"), e.get("event_index"))
        if key in seen: continue
        seen.add(key)
        a = tron_addr_from_event(e)
        rows.append({"tx":e.get("transaction_id"),"event_index":e.get("event_index"),"block":e.get("block_number"),"ts_ms":e.get("block_timestamp"),"addr":a})
    return rows

# --- Config ---
# Window boundaries
r = egetj({"module":"proxy","action":"eth_blockNumber"}); throttle()
head = int(r["result"],16)
now_ms = int(time.time()*1000)
window_ms = 30*86400*1000
start_ms = now_ms - window_ms
start_block_30d = head - 216000
print(f"ETH head={head}  30d_from_block={start_block_30d}", flush=True)
print(f"Tron window: {start_ms}..{now_ms}", flush=True)

# Deployment blocks (approx; conservative lower bound is fine)
DEPLOY = {
    "ETH_USDT_0xdAC17F958D2ee523a2206206994597C13D831ec7": 4634748,
    "ETH_USDC_0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 6082465,
    "BUSD_0x4Fabb145d64652a948d72533023f6E7A623C7C53":      8493709,
    "USDP_0x8E870D67F660D95d5be530380D0eC0bd388289E1":      14653265,
    "TUSD_0x0000000000085d4780B73119b644AE5ecd22b376":      11506213,
}

# Address + event-set per contract
ETH_CONTRACTS = [
    ("ETH_USDT", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 4634748,
        {"add":"AddedBlackList(address)", "remove":"RemovedBlackList(address)"}),
    ("ETH_USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6082465,
        {"add":"Blacklisted(address)", "remove":"UnBlacklisted(address)"}),
    ("BUSD",     "0x4Fabb145d64652a948d72533023f6E7A623C7C53", 8493709,
        {"add":"AddressFrozen(address)", "remove":"AddressUnfrozen(address)"}),
    ("USDP",     "0x8E870D67F660D95d5be530380D0eC0bd388289E1", 14653265,
        {"add":"FreezeAddress(address)", "remove":"UnfreezeAddress(address)"}),
    ("TUSD",     "0x0000000000085d4780B73119b644AE5ecd22b376", 11506213,
        {"add":"Blacklisted(address)", "remove":"UnBlacklisted(address)"}),
]
TRON_CONTRACTS = [
    ("TRON_USDT", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", {"add":"AddedBlackList","remove":"RemovedBlackList"}),
    ("TRON_USDC", "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", {"add":"Blacklisted","remove":"UnBlacklisted"}),
]

census = {}

# ETH contracts
for name, addr, deploy_b, evts in ETH_CONTRACTS:
    print(f"\n=== {name} ({addr}) ===", flush=True)
    add_sig = evts["add"]; rem_sig = evts["remove"]
    add_t = topic(add_sig); rem_t = topic(rem_sig)
    print(f"  add_topic0={add_t}  rem_topic0={rem_t}", flush=True)
    print(f"  scanning all-time adds [{deploy_b}..{head}]", flush=True)
    all_adds_raw = eth_getlogs_range(addr, add_t, deploy_b, head)
    all_adds = dedup_eth(all_adds_raw)
    print(f"  all-time add rows (deduped): {len(all_adds)}", flush=True)
    print(f"  scanning all-time removes", flush=True)
    all_rems_raw = eth_getlogs_range(addr, rem_t, deploy_b, head)
    all_rems = dedup_eth(all_rems_raw)
    print(f"  all-time rem rows (deduped): {len(all_rems)}", flush=True)
    distinct_added = {r["addr"] for r in all_adds if r["addr"]}
    distinct_removed = {r["addr"] for r in all_rems if r["addr"]}
    currently_frozen = distinct_added - distinct_removed
    adds_30d = [r for r in all_adds if r["block"] >= start_block_30d]
    rems_30d = [r for r in all_rems if r["block"] >= start_block_30d]
    distinct_adds_30d = {r["addr"] for r in adds_30d if r["addr"]}
    distinct_rems_30d = {r["addr"] for r in rems_30d if r["addr"]}
    census[name] = {
        "address": addr,
        "add_event": add_sig,
        "remove_event": rem_sig,
        "scan_from_block": deploy_b,
        "scan_to_block": head,
        "all_time_add_events": len(all_adds),
        "all_time_remove_events": len(all_rems),
        "all_time_distinct_added": len(distinct_added),
        "all_time_distinct_removed": len(distinct_removed),
        "all_time_currently_frozen": len(currently_frozen),
        "d30_add_events": len(adds_30d),
        "d30_remove_events": len(rems_30d),
        "d30_distinct_added": len(distinct_adds_30d),
        "d30_distinct_removed": len(distinct_rems_30d),
        "addresses": {
            "all_time_added": sorted(distinct_added),
            "all_time_removed": sorted(distinct_removed),
            "currently_frozen": sorted(currently_frozen),
            "d30_added": sorted(distinct_adds_30d),
            "d30_removed": sorted(distinct_rems_30d),
        },
    }
    print(f"  all-time: added={len(distinct_added)} removed={len(distinct_removed)} currently_frozen={len(currently_frozen)}", flush=True)
    print(f"  30d: add_evt={len(adds_30d)} rem_evt={len(rems_30d)} distinct_new={len(distinct_adds_30d)} distinct_rem={len(distinct_rems_30d)}", flush=True)
    print(f"  (etherscan calls so far: {ETH_CALLS})", flush=True)

# Tron contracts
for name, addr, evts in TRON_CONTRACTS:
    print(f"\n=== {name} ({addr}) ===", flush=True)
    print(f"  scanning all-time adds [{evts['add']}]", flush=True)
    all_adds_raw = trongrid_events(addr, evts["add"])
    all_adds = dedup_tron(all_adds_raw)
    print(f"  all-time add rows (deduped): {len(all_adds)}  (raw: {len(all_adds_raw)})", flush=True)
    print(f"  scanning all-time removes [{evts['remove']}]", flush=True)
    all_rems_raw = trongrid_events(addr, evts["remove"])
    all_rems = dedup_tron(all_rems_raw)
    print(f"  all-time rem rows (deduped): {len(all_rems)}  (raw: {len(all_rems_raw)})", flush=True)
    distinct_added = {r["addr"] for r in all_adds if r["addr"]}
    distinct_removed = {r["addr"] for r in all_rems if r["addr"]}
    currently_frozen = distinct_added - distinct_removed
    adds_30d = [r for r in all_adds if (r["ts_ms"] or 0) >= start_ms]
    rems_30d = [r for r in all_rems if (r["ts_ms"] or 0) >= start_ms]
    distinct_adds_30d = {r["addr"] for r in adds_30d if r["addr"]}
    distinct_rems_30d = {r["addr"] for r in rems_30d if r["addr"]}
    census[name] = {
        "address": addr,
        "add_event": evts["add"],
        "remove_event": evts["remove"],
        "all_time_add_events": len(all_adds),
        "all_time_remove_events": len(all_rems),
        "all_time_distinct_added": len(distinct_added),
        "all_time_distinct_removed": len(distinct_removed),
        "all_time_currently_frozen": len(currently_frozen),
        "d30_add_events": len(adds_30d),
        "d30_remove_events": len(rems_30d),
        "d30_distinct_added": len(distinct_adds_30d),
        "d30_distinct_removed": len(distinct_rems_30d),
        "addresses": {
            "all_time_added": sorted([a for a in distinct_added if a]),
            "all_time_removed": sorted([a for a in distinct_removed if a]),
            "currently_frozen": sorted([a for a in currently_frozen if a]),
            "d30_added": sorted([a for a in distinct_adds_30d if a]),
            "d30_removed": sorted([a for a in distinct_rems_30d if a]),
        },
    }
    print(f"  all-time: added={len(distinct_added)} removed={len(distinct_removed)} currently_frozen={len(currently_frozen)}", flush=True)
    print(f"  30d: add_evt={len(adds_30d)} rem_evt={len(rems_30d)} distinct_new={len(distinct_adds_30d)} distinct_rem={len(distinct_rems_30d)}", flush=True)
    print(f"  (trongrid calls so far: {TRON_CALLS})", flush=True)

totals = {
    "all_time_distinct_added_sum": sum(c["all_time_distinct_added"] for c in census.values()),
    "all_time_currently_frozen_sum": sum(c["all_time_currently_frozen"] for c in census.values()),
    "d30_add_events_sum": sum(c["d30_add_events"] for c in census.values()),
    "d30_distinct_added_sum": sum(c["d30_distinct_added"] for c in census.values()),
    "d30_remove_events_sum": sum(c["d30_remove_events"] for c in census.values()),
    "d30_distinct_removed_sum": sum(c["d30_distinct_removed"] for c in census.values()),
}
print("\n=== TOTALS ===", flush=True)
for k,v in totals.items(): print(f"  {k} = {v}", flush=True)
print(f"\netherscan_calls_used={ETH_CALLS}/{ETH_CEILING}, trongrid_calls_used={TRON_CALLS}", flush=True)

out = {
    "generated_at_utc": datetime.datetime.utcnow().isoformat()+"Z",
    "method": "Etherscan V2 logs/getLogs + TronGrid v1/contracts/{addr}/events; dedup by (tx_hash,log_index) / (transaction_id,event_index)",
    "eth_head_block": head,
    "eth_30d_from_block": start_block_30d,
    "tron_30d_window_ms": {"from": start_ms, "to": now_ms},
    "etherscan_calls_used": ETH_CALLS,
    "trongrid_calls_used": TRON_CALLS,
    "census": census,
    "totals": totals,
}
json.dump(out, open("/tmp/wlaudit/census.json","w"))
print("wrote /tmp/wlaudit/census.json  size_bytes=", os.path.getsize("/tmp/wlaudit/census.json"))
