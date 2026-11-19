import os, json, urllib.request, urllib.parse, time
from Crypto.Hash import keccak
EK=os.environ["ETHERSCAN_API_KEY"]
def kk(s): k=keccak.new(digest_bits=256); k.update(s.encode()); return "0x"+k.hexdigest()
def eget(p):
    p={**p,"apikey":EK,"chainid":1}
    with urllib.request.urlopen("https://api.etherscan.io/v2/api?"+urllib.parse.urlencode(p),timeout=20) as r:
        return json.loads(r.read().decode())
def thr(): time.sleep(0.4)

USDT="0xdAC17F958D2ee523a2206206994597C13D831ec7"
# isBlackListed(address) selector
sel = kk("isBlackListed(address)")[:10]
# raw data from investigate.json to get full list
invest = json.load(open("/tmp/wlaudit/investigate.json"))
near = invest["eth_usdt_near_zero_verdicts"]
print(f"Querying USDT.isBlackListed() for all {len(near)} near-zero entries...")
results = []
for v in near:
    addr = v["event_addr"]
    data = sel + "0"*24 + addr[2:]
    r = eget({"module":"proxy","action":"eth_call","to":USDT,"data":data,"tag":"latest"}); thr()
    ret = r.get("result","")
    is_bl = ret.endswith("1") if ret else None
    results.append({"addr":addr,"is_blacklisted_now": is_bl, "raw": ret})
n_yes = sum(1 for r in results if r["is_blacklisted_now"])
print(f"  currently blacklisted on-chain: {n_yes}/{len(results)}")
for r in results:
    print(f"    {r['addr']}  isBlacklisted={r['is_blacklisted_now']}")
json.dump(results, open("/tmp/wlaudit/isblacklisted.json","w"), indent=2)

# Also widen filter: lead-16-hex-zero (first 8 bytes zero) across both USDT contracts
print("\n--- Widening filter to lead-16-hex-zero ---")
cen = json.load(open("docs/evidence/watchlist-30d-counts.json"))["census"]
def wide(a): return bool(a) and a.startswith("0x") and a[2:18]=="0"*16
for cname in ["ETH_USDT","TRON_USDT","ETH_USDC","TRON_USDC","BUSD","USDP","TUSD"]:
    adds = cen[cname]["addresses"]["all_time_added"]
    cf = cen[cname]["addresses"]["currently_frozen"]
    print(f"  {cname}: all_time_added wide={sum(1 for a in adds if wide(a))}  currently_frozen wide={sum(1 for a in cf if wide(a))}")
