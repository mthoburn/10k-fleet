import os, json, urllib.request, urllib.parse, time
KEY = os.environ["ETHERSCAN_API_KEY"]
def get(params):
    params = {**params, "apikey": KEY, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.loads(r.read().decode())
def throttle(): time.sleep(0.4)

# 1. Resolve Aave V3 PoolConfigurator EIP-1967 implementation
CONFIG = "0x64b761D848206f447Fe2dd461b0c635Ec39EbB27"
SLOT_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
r = get({"module":"proxy","action":"eth_getStorageAt","address":CONFIG,"position":SLOT_IMPL,"tag":"latest"})
throttle()
impl_hex = r.get("result","")
impl_addr = "0x" + impl_hex[-40:] if impl_hex else None
print("Aave PoolConfigurator impl =", impl_addr)

if impl_addr and impl_addr != "0x" + "0"*40:
    r = get({"module":"contract","action":"getabi","address":impl_addr}); throttle()
    if r.get("status") == "1":
        abi = json.loads(r["result"])
        evts = [e["name"] for e in abi if e.get("type")=="event"]
        print(f"  n_events on impl = {len(evts)}")
        pause_like = [n for n in evts if any(k in n.lower() for k in ["paus","freeze","frozen","unfreeze","unpaus","emergency","killed","reserveactive"])]
        print(f"  pause/freeze events = {pause_like}")
    else:
        print("  getabi failed:", r.get("result",""))

# 2. Also check Aave V3 Pool itself (not configurator)
POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
r = get({"module":"proxy","action":"eth_getStorageAt","address":POOL,"position":SLOT_IMPL,"tag":"latest"}); throttle()
impl_pool = "0x" + r.get("result","")[-40:] if r.get("result") else None
print("Aave Pool impl =", impl_pool)
if impl_pool and impl_pool != "0x" + "0"*40:
    r = get({"module":"contract","action":"getabi","address":impl_pool}); throttle()
    if r.get("status") == "1":
        abi = json.loads(r["result"])
        evts = [e["name"] for e in abi if e.get("type")=="event"]
        pause_like = [n for n in evts if any(k in n.lower() for k in ["paus","freeze","frozen","unfreeze","unpaus","emergency","killed"])]
        print(f"  pool impl n_events={len(evts)} pause/freeze events = {pause_like}")

# 3. Spot-check a Curve pool (3pool, 0xbEbc44...) — classic
TRIPOOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"
r = get({"module":"contract","action":"getabi","address":TRIPOOL}); throttle()
if r.get("status") == "1":
    abi = json.loads(r["result"])
    evts = [e["name"] for e in abi if e.get("type")=="event"]
    admin_funcs = [e["name"] for e in abi if e.get("type")=="function" and any(k in e.get("name","").lower() for k in ["kill","emergency","paus","admin","shutdown","freez"])]
    print(f"Curve 3pool: events={evts}")
    print(f"  admin-like functions: {admin_funcs}")
