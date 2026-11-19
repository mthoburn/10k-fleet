import os, json, urllib.request, urllib.parse, time
KEY = os.environ["ETHERSCAN_API_KEY"]
def get(params):
    params = {**params, "apikey": KEY, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=25) as r:
        return json.loads(r.read().decode())
def throttle(): time.sleep(0.4)

targets = [
    ("ETH USDT", "0xdAC17F958D2ee523a2206206994597C13D831ec7"),
    ("ETH USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
]
# USDC is a proxy (FiatTokenProxy); need impl
SLOT_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"

for name, addr in targets:
    r = get({"module":"proxy","action":"eth_getStorageAt","address":addr,"position":SLOT_IMPL,"tag":"latest"}); throttle()
    impl_hex = r.get("result","")
    impl = "0x" + impl_hex[-40:] if impl_hex else None
    is_proxy = impl and impl != "0x" + "0"*40
    probe = impl if is_proxy else addr
    r = get({"module":"contract","action":"getabi","address":probe}); throttle()
    if r.get("status") != "1":
        print(f"{name} getabi FAIL addr={probe} err={r.get('result','')}"); continue
    abi = json.loads(r["result"])
    evts = [e["name"] for e in abi if e.get("type")=="event"]
    matched = [n for n in evts if any(k in n for k in ["Paused","Unpaused","Pause","Unpause","Blacklist","BlackList","Freeze","Frozen","Destroyed"])]
    print(f"{name}: addr={addr} proxy_impl={impl if is_proxy else '(not proxy)'}")
    print(f"  qualifying events: {matched}")

# Aave V3 ReservePaused frequency probe, 30d
# ReservePaused(address indexed asset, bool paused) sig keccak = 0x... — use topic0 from logs
# Query Etherscan getLogs for PoolConfigurator over last 30 days
print()
print("=== Aave V3 PoolConfigurator event frequency (last ~30d) ===")
# Get current block
r = get({"module":"proxy","action":"eth_blockNumber"}); throttle()
head = int(r["result"],16)
# ~12s per block → 30d = 216,000 blocks
start = head - 216000
print(f"head={head} start={start}")
CONFIG = "0x64b761D848206f447Fe2dd461b0c635Ec39EbB27"
# Fetch all logs for the configurator over window; filter client-side by topic names.
# Pull all (may be large). Use pagination defensively.
r = get({"module":"logs","action":"getLogs","address":CONFIG,
         "fromBlock":str(start),"toBlock":str(head),"page":"1","offset":"1000"})
throttle()
logs = r.get("result",[])
print(f"  returned_logs (max 1000): {len(logs)}")
# Compute topic0 for the 3 pause/freeze events by hashing their canonical sigs
# We need keccak256; use web3-style via hashlib? No keccak in stdlib. Use pysha3? Fallback: infer from known Aave V3 topic0s
TOPIC0 = {
    "ReservePaused":  "0x8c711ca5d59e193962d5f3d20ec6c06ab7975971bab6fa62eb0fd04c0ab2e0d7",  # placeholder
}
# Hardcoded canonical topic0 from Aave V3 source
# ReservePaused(address indexed asset, bool paused): keccak("ReservePaused(address,bool)") 
# Let's just group by first topic to see what fired
from collections import Counter
c = Counter(l.get("topics",["none"])[0] for l in logs)
print(f"  distinct topic0s: {len(c)}")
for t,n in c.most_common(10):
    print(f"    {t}  count={n}")
