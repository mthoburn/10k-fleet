import os, json, urllib.request, urllib.parse, time, random
from Crypto.Hash import keccak
EK = os.environ["ETHERSCAN_API_KEY"]
TK = os.environ["TRONGRID_API_KEY"]

def ekeccak(s):
    k=keccak.new(digest_bits=256); k.update(s.encode() if isinstance(s,str) else s); return "0x" + k.hexdigest()

def eget(params):
    params = {**params, "apikey": EK, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=25) as r:
        return json.loads(r.read().decode())
def throttle(): time.sleep(0.4)

def tron_hex_to_base58(hex20):
    # hex20 = 20-byte 0x-prefixed hex. Tron address = 0x41 || hex20 || checksum
    # checksum = first 4 bytes of sha256(sha256(0x41||hex20))
    import hashlib, base58
    raw = bytes.fromhex("41" + hex20[2:])
    cs = hashlib.sha256(hashlib.sha256(raw).digest()).digest()[:4]
    return base58.b58encode(raw+cs).decode()

# Pick case-1 wallet
cen = json.load(open("docs/evidence/watchlist-30d-counts.json"))["census"]
WALLET = cen["ETH_USDC"]["addresses"]["d30_removed"][0]
assert WALLET in set(cen["ETH_USDC"]["addresses"]["all_time_added"]), "sanity: wallet not in all_time_added"
print("=== Case-1 wallet (ETH_USDC) ===")
print("wallet:", WALLET)

USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
pad = "0x" + "0"*24 + WALLET[2:]
# Blacklisted(address indexed _account) → indexed, topic1 filter
topic_bl = ekeccak("Blacklisted(address)")
topic_un = ekeccak("UnBlacklisted(address)")

def find_log(address, topic0, topic1, from_block, to_block):
    r = eget({"module":"logs","action":"getLogs","address":address,
              "fromBlock":str(from_block),"toBlock":str(to_block),
              "topic0":topic0,"topic1":topic1,"page":"1","offset":"1000"})
    throttle()
    if isinstance(r.get("result"), str):
        if r.get("message")=="No records found": return []
        raise RuntimeError(r)
    return r.get("result",[])

head_r = eget({"module":"proxy","action":"eth_blockNumber"}); throttle()
head = int(head_r["result"],16)

bl_logs = find_log(USDC, topic_bl, pad, 6082465, head)
un_logs = find_log(USDC, topic_un, pad, 6082465, head)
print(f"  Blacklisted logs for this wallet: {len(bl_logs)}")
print(f"  UnBlacklisted logs for this wallet: {len(un_logs)}")
def row(l): return {"tx":l["transactionHash"], "block":int(l["blockNumber"],16), "log_index":int(l["logIndex"],16), "block_ts": int(l.get("timeStamp","0x0"),16)}
freeze_tx = row(bl_logs[0]) if bl_logs else None
unfr_tx = row(un_logs[-1]) if un_logs else None  # most recent
print("  freeze tx:", freeze_tx)
print("  unfreeze tx:", unfr_tx)

# ---------- Item 3: near-zero diagnosis ----------
print("\n=== Near-zero address diagnosis ===")
# ETH_USDT: fetch one AddedBlackList log matching data=0x...0000 (wallet=0x0000..00)
usdt = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
t0 = ekeccak("AddedBlackList(address)")
# Pull a chunk of AddedBlackList logs across early years (2017-2019) where oddities likely
r = eget({"module":"logs","action":"getLogs","address":usdt,
          "fromBlock":"4634748","toBlock":"9000000","topic0":t0,"page":"1","offset":"1000"})
throttle()
sus = []
if isinstance(r.get("result"), list):
    for l in r["result"]:
        data = l.get("data","")
        topics = l.get("topics",[])
        if data and len(data)>=66:
            w = "0x" + data[2:66][-40:].lower()
            if w.startswith("0x"+"0"*24):
                sus.append({"tx":l["transactionHash"],"block":int(l["blockNumber"],16),
                            "topics_n":len(topics),"data_full":data,"decoded_wallet":w})
                if len(sus)>=3: break
print(f"  ETH_USDT near-zero AddedBlackList samples (first 3):")
for s in sus:
    print(f"    tx={s['tx']} block={s['block']} topics_n={s['topics_n']} wallet={s['decoded_wallet']}")
    print(f"      raw data: {s['data_full']}")

# TRON_USDT: fetch one AddedBlackList event with a near-zero wallet
# Use TronGrid events filter by name, scan a few pages, check result
def tron_events(addr, name, limit=200, pages=5):
    out = []
    fingerprint=None
    for _ in range(pages):
        params={"event_name":name,"limit":str(limit),"order_by":"block_timestamp,asc"}
        if fingerprint: params["fingerprint"]=fingerprint
        url=f"https://api.trongrid.io/v1/contracts/{addr}/events?"+urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"TRON-PRO-API-KEY":TK})
        with urllib.request.urlopen(req, timeout=30) as r:
            d=json.loads(r.read().decode())
        out.extend(d.get("data",[]))
        fingerprint=(d.get("meta") or {}).get("fingerprint")
        if not fingerprint: break
        time.sleep(0.1)
    return out
tron_sample = tron_events("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","AddedBlackList",limit=200,pages=3)
print(f"\n  TRON_USDT first {len(tron_sample)} AddedBlackList events; scanning for near-zero...")
sus_t = []
for e in tron_sample:
    res = e.get("result") or {}
    # find any value that is 0x-prefixed with first 10 bytes zero
    for k,v in res.items():
        if isinstance(v,str) and v.startswith("0x") and len(v)==42 and v[2:22]=="0"*20:
            sus_t.append({"tx":e.get("transaction_id"),"block":e.get("block_number"),
                          "result":res,"full_event":e})
            break
    if len(sus_t)>=3: break
for s in sus_t:
    print(f"    tx={s['tx']} block={s['block']} result={s['result']}")

# ---------- Item 4: dormant sample (500 addrs, mixed contracts, excluding near-zero) ----------
print("\n=== Dormant sample building ===")
random.seed(42)
EXCLUDE = set()
# Build exclusion set from near-zero padded in any set
for cname,cv in cen.items():
    for lst_name in ("currently_frozen",):
        for a in cv["addresses"][lst_name]:
            if a and a.startswith("0x") and a[2:22]=="0"*20:
                EXCLUDE.add((cname,a))

def near_zero(a): return bool(a) and a.startswith("0x") and a[2:22]=="0"*20

# Per-contract clean currently_frozen
clean = {}
for cname,cv in cen.items():
    lst = [a for a in cv["addresses"]["currently_frozen"] if a and not near_zero(a)]
    clean[cname] = lst
    print(f"  {cname} clean currently_frozen: {len(lst)}  (dropped near-zero: {cv['all_time_currently_frozen']-len(lst)})")

# Totals
new_total = sum(len(v) for v in clean.values())
print(f"  cleaned currently_frozen total: {new_total} (was {sum(cv['all_time_currently_frozen'] for cv in cen.values())})")

# Sample 500, proportional to contract share
sample = []
weights = {k: len(v) for k,v in clean.items()}
tot = sum(weights.values())
for k,v in clean.items():
    n = round(500 * weights[k]/tot)
    sample.extend([(k,a) for a in random.sample(v, min(n, len(v)))])
# trim/pad to 500
sample = sample[:500]
print(f"  built sample size: {len(sample)}")

# Format: for Tron entries, include base58 + hex
try:
    import base58
except ImportError:
    print("  (installing base58)")
    import subprocess; subprocess.check_call(["pip3","install","--quiet","base58"])
    import base58

def to_base58(hex20):
    import hashlib
    raw = bytes.fromhex("41" + hex20[2:])
    cs = hashlib.sha256(hashlib.sha256(raw).digest()).digest()[:4]
    return base58.b58encode(raw+cs).decode()

rows = []
for cname,a in sample:
    chain = "tron" if cname.startswith("TRON") else "eth"
    entry = {"source_contract": cname, "chain": chain, "address": a}
    if chain=="tron":
        entry["tron_base58"] = to_base58(a)
    rows.append(entry)

out = {
    "generated_at_utc": __import__("datetime").datetime.utcnow().isoformat()+"Z",
    "source": "docs/evidence/watchlist-30d-counts.json → census.*.addresses.currently_frozen",
    "excluded_from_sample": "addresses with leading 10 bytes of zero (suspected decode artefacts; see Case-1 ask § item 3)",
    "sample_size": len(rows),
    "composition_by_contract": {k: sum(1 for r in rows if r["source_contract"]==k) for k in cen},
    "rows": rows,
}
with open("docs/evidence/dormant-sample-500.json","w") as f:
    json.dump(out, f, indent=2)
print("  wrote docs/evidence/dormant-sample-500.json bytes=", os.path.getsize("docs/evidence/dormant-sample-500.json"))

# Also compute Case-1 wallet Tron base58 (N/A, it's ETH)
print()
