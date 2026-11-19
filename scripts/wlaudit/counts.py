import os, json, urllib.request, urllib.parse, time, datetime
from Crypto.Hash import keccak
EK = os.environ["ETHERSCAN_API_KEY"]
TK = os.environ["TRONGRID_API_KEY"]
def egetj(params):
    params = {**params, "apikey": EK, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())
def throttle(): time.sleep(0.4)
def topic(sig):
    k=keccak.new(digest_bits=256); k.update(sig.encode()); return "0x" + k.hexdigest()

# --- blockrange ---
r = egetj({"module":"proxy","action":"eth_blockNumber"}); throttle()
head = int(r["result"],16)
# 30d at 12s/block
BLOCKS = 216000
start = head - BLOCKS
now_ms = int(time.time()*1000)
window_ms = 30*86400*1000
start_ms = now_ms - window_ms
print(f"ETH range: {start}..{head} ({BLOCKS} blocks ≈ 30d)")
print(f"Tron range: min_block_timestamp={start_ms} .. now={now_ms}")

def getlogs_all(address, topic0):
    """Paginated getLogs."""
    out = []
    page = 1
    while True:
        params = {"module":"logs","action":"getLogs","address":address,
                  "fromBlock":str(start),"toBlock":str(head),
                  "topic0":topic0,"page":str(page),"offset":"1000"}
        r = egetj(params); throttle()
        if isinstance(r.get("result"), str):
            # "No records found" or error
            msg = r.get("message","")
            if msg == "No records found" or r.get("status")=="0":
                break
            raise RuntimeError(f"getlogs err: {r}")
        chunk = r.get("result",[])
        out.extend(chunk)
        if len(chunk) < 1000: break
        page += 1
        if page > 20: break  # safety
    return out

def trongrid_events(address_base58, event_name, limit=200):
    out = []
    fingerprint = None
    pages = 0
    while True:
        url = f"https://api.trongrid.io/v1/contracts/{address_base58}/events"
        params = {"event_name":event_name,"min_block_timestamp":str(start_ms),
                  "limit":str(limit),"order_by":"block_timestamp,asc"}
        if fingerprint: params["fingerprint"]=fingerprint
        req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params),
                                     headers={"TRON-PRO-API-KEY": TK})
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read().decode())
        chunk = d.get("data",[])
        out.extend(chunk)
        meta = d.get("meta") or {}
        fingerprint = meta.get("fingerprint")
        pages += 1
        if not fingerprint or len(chunk)==0: break
        if pages > 50: break
        time.sleep(0.2)
    return out

ETH_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
ETH_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
TRON_USDC = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8"

TOPICS = {
    "AddedBlackList(address)": topic("AddedBlackList(address)"),
    "RemovedBlackList(address)": topic("RemovedBlackList(address)"),
    "DestroyedBlackFunds(address,uint256)": topic("DestroyedBlackFunds(address,uint256)"),
    "Blacklisted(address)": topic("Blacklisted(address)"),
    "UnBlacklisted(address)": topic("UnBlacklisted(address)"),
    "Pause()": topic("Pause()"),
    "Unpause()": topic("Unpause()"),
    "Paused(address)": topic("Paused(address)"),  # OZ variant
    "Unpaused(address)": topic("Unpaused(address)"),
}

print("\n--- ETH USDT ---")
usdt_adds = getlogs_all(ETH_USDT, TOPICS["AddedBlackList(address)"])
usdt_rems = getlogs_all(ETH_USDT, TOPICS["RemovedBlackList(address)"])
usdt_destroyed = getlogs_all(ETH_USDT, TOPICS["DestroyedBlackFunds(address,uint256)"])
print(f"  AddedBlackList: {len(usdt_adds)}")
print(f"  RemovedBlackList: {len(usdt_rems)}")
print(f"  DestroyedBlackFunds: {len(usdt_destroyed)}")

print("\n--- ETH USDC ---")
usdc_adds = getlogs_all(ETH_USDC, TOPICS["Blacklisted(address)"])
usdc_rems = getlogs_all(ETH_USDC, TOPICS["UnBlacklisted(address)"])
print(f"  Blacklisted: {len(usdc_adds)}")
print(f"  UnBlacklisted: {len(usdc_rems)}")

print("\n--- Tron USDT ---")
t_usdt_adds = trongrid_events(TRON_USDT, "AddedBlackList")
t_usdt_rems = trongrid_events(TRON_USDT, "RemovedBlackList")
t_usdt_destroyed = trongrid_events(TRON_USDT, "DestroyedBlackFunds")
print(f"  AddedBlackList: {len(t_usdt_adds)}")
print(f"  RemovedBlackList: {len(t_usdt_rems)}")
print(f"  DestroyedBlackFunds: {len(t_usdt_destroyed)}")

print("\n--- Tron USDC ---")
t_usdc_adds = trongrid_events(TRON_USDC, "Blacklisted")
t_usdc_rems = trongrid_events(TRON_USDC, "UnBlacklisted")
print(f"  Blacklisted: {len(t_usdc_adds)}")
print(f"  UnBlacklisted: {len(t_usdc_rems)}")

adds_total = len(usdt_adds)+len(usdc_adds)+len(t_usdt_adds)+len(t_usdc_adds)
rems_total = len(usdt_rems)+len(usdc_rems)+len(t_usdt_rems)+len(t_usdc_rems)
destroyed_total = len(usdt_destroyed)+len(t_usdt_destroyed)

print(f"\nN (adds) = {adds_total}")
print(f"removals = {rems_total}")
print(f"destroyed (USDT only) = {destroyed_total}")

# Save raw receipts
evidence = {
    "generated_at_utc": datetime.datetime.utcnow().isoformat()+"Z",
    "method": "Etherscan V2 logs/getLogs + TronGrid v1/contracts/{addr}/events",
    "eth_blockrange": {"from": start, "to": head, "approx_days": 30, "blocks": BLOCKS},
    "tron_time_window_ms": {"from": start_ms, "to": now_ms},
    "topic0_computed": TOPICS,
    "counts": {
        "eth_usdt": {
            "address": ETH_USDT,
            "AddedBlackList": len(usdt_adds),
            "RemovedBlackList": len(usdt_rems),
            "DestroyedBlackFunds": len(usdt_destroyed),
        },
        "eth_usdc": {
            "address": ETH_USDC,
            "Blacklisted": len(usdc_adds),
            "UnBlacklisted": len(usdc_rems),
        },
        "tron_usdt": {
            "address": TRON_USDT,
            "AddedBlackList": len(t_usdt_adds),
            "RemovedBlackList": len(t_usdt_rems),
            "DestroyedBlackFunds": len(t_usdt_destroyed),
        },
        "tron_usdc": {
            "address": TRON_USDC,
            "Blacklisted": len(t_usdc_adds),
            "UnBlacklisted": len(t_usdc_rems),
        },
    },
    "aggregates": {
        "N_adds_headline": adds_total,
        "N_adds_fallback_no_tron_usdc": adds_total - len(t_usdc_adds),
        "removals_total": rems_total,
        "destroyed_total_usdt_only": destroyed_total,
    },
}
# Keep small sample tx refs per bucket for auditability (first 3)
def sample(logs, is_tron=False):
    if is_tron:
        return [{"tx":l.get("transaction_id"),"block":l.get("block_number"),"ts":l.get("block_timestamp")} for l in logs[:3]]
    return [{"tx":l.get("transactionHash"),"block":int(l.get("blockNumber","0x0"),16) if l.get("blockNumber","").startswith("0x") else l.get("blockNumber")} for l in logs[:3]]
evidence["samples"] = {
    "eth_usdt_AddedBlackList_first3": sample(usdt_adds),
    "eth_usdc_Blacklisted_first3": sample(usdc_adds),
    "tron_usdt_AddedBlackList_first3": sample(t_usdt_adds, True),
    "tron_usdc_Blacklisted_first3": sample(t_usdc_adds, True),
}
json.dump(evidence, open("/tmp/wlaudit/counts.json","w"), indent=2)
print("\nwrote /tmp/wlaudit/counts.json")
