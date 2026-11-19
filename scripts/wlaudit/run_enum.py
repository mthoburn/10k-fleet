import os, json, time, urllib.request, urllib.parse, sys, re

ETHERSCAN = "https://api.etherscan.io/v2/api"
KEY = os.environ["ETHERSCAN_API_KEY"]
CHAINID = 1

# selection rule: ABI contains at least one Event whose name matches this regex
SELECT_RE = re.compile(r'^(Paused|Unpaused|Pause|Unpause|Blacklisted|UnBlacklisted|Blacklist|UnBlacklist|Freeze|Unfreeze|Frozen|Unfrozen|FrozenFunds|AddressFrozen|AddressThawed|AddedBlackList|RemovedBlackList|DestroyedBlackFunds|ReservePaused|ReserveUnpaused|EmergencyShutdown|Killed|Kill|SetKilled|SetPaused|SetEmergency|ReserveActive)$')

def get(params, tries=3):
    params = {**params, "apikey": KEY, "chainid": CHAINID}
    url = ETHERSCAN + "?" + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if i == tries-1: raise
            time.sleep(1.5)

def eth_call(to, data):
    r = get({"module":"proxy","action":"eth_call","to":to,"data":data,"tag":"latest"})
    return r.get("result")

def getabi(addr):
    r = get({"module":"contract","action":"getabi","address":addr})
    if r.get("status") != "1": return None, r.get("result","")
    try:
        return json.loads(r["result"]), ""
    except: return None, "parse_fail"

def selectors(sig):
    from hashlib import sha3_256
    # keccak256 of the signature; Python's hashlib doesn't have keccak natively.
    # We'll use pycryptodome if available; fall back to precomputed selectors.
    return None

PRECOMPUTED = {
    "pool_count()": "0x956aae3a",
    "pool_list(uint256)": "0x3a1d5d8e",
    "getReservesList()": "0xd1946dbc",
}

def enc_pool_list(i):
    return PRECOMPUTED["pool_list(uint256)"] + f"{i:064x}"

def dec_addr(hexstr):
    if not hexstr or not hexstr.startswith("0x"): return None
    s = hexstr[-40:]
    return "0x" + s

def dec_uint(hexstr):
    if not hexstr: return 0
    return int(hexstr, 16)

def dec_addr_array(hexstr):
    # eth ABI dynamic address array: offset(32) + length(32) + addrs
    if not hexstr or not hexstr.startswith("0x"): return []
    data = bytes.fromhex(hexstr[2:])
    # skip offset word (first 32 bytes), read length
    length = int.from_bytes(data[32:64], "big")
    out = []
    for i in range(length):
        a = data[64 + i*32 + 12 : 64 + (i+1)*32]
        out.append("0x" + a.hex())
    return out

RATE = 0.4  # ~2.5 rps, under 3 rps limit
def throttle(): time.sleep(RATE)

results = {"curve_pools": [], "aave": {}, "errors": []}

# --- Aave V3 reserves ---
AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
AAVE_CONFIG = "0x64b761D848206f447Fe2dd461b0c635Ec39EbB27"
print("aave: getReservesList()", flush=True)
r = eth_call(AAVE_POOL, PRECOMPUTED["getReservesList()"])
throttle()
reserves = dec_addr_array(r) if r else []
print(f"aave: n_reserves={len(reserves)}", flush=True)
# ABI check PoolConfigurator
abi, err = getabi(AAVE_CONFIG); throttle()
pc_events = []
if abi:
    pc_events = [e["name"] for e in abi if e.get("type")=="event"]
pc_matches = [n for n in pc_events if SELECT_RE.match(n)]
results["aave"] = {
    "pool": AAVE_POOL, "pool_configurator": AAVE_CONFIG,
    "n_reserves": len(reserves), "reserves": reserves,
    "configurator_matched_events": pc_matches,
    "configurator_all_event_count": len(pc_events),
}
print(f"aave: matched events on PoolConfigurator = {pc_matches}", flush=True)

# --- Curve StableSwap main registry ---
CURVE_REG = "0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5"
print("curve: pool_count()", flush=True)
r = eth_call(CURVE_REG, PRECOMPUTED["pool_count()"])
throttle()
n = dec_uint(r)
print(f"curve: pool_count={n}", flush=True)

pools = []
for i in range(n):
    r = eth_call(CURVE_REG, enc_pool_list(i))
    throttle()
    a = dec_addr(r)
    if a and a != "0x" + "0"*40: pools.append(a)
print(f"curve: enumerated {len(pools)} pool addrs", flush=True)

# ABI-check each pool
qualifying = []
sentinels_candidate = []  # qualifying but need separate event-count step to confirm never-fired
disqualified = []
abi_failures = []
for idx, addr in enumerate(pools):
    abi, err = getabi(addr); throttle()
    if abi is None:
        abi_failures.append({"addr": addr, "err": err}); continue
    evts = [e["name"] for e in abi if e.get("type")=="event"]
    matched = [n for n in evts if SELECT_RE.match(n)]
    row = {"addr": addr, "events_matched": matched, "n_events": len(evts)}
    if matched: qualifying.append(row)
    else: disqualified.append({"addr": addr, "n_events": len(evts)})
    if (idx+1) % 10 == 0:
        print(f"curve: {idx+1}/{len(pools)} checked (qual so far = {len(qualifying)})", flush=True)

results["curve_pools"] = {
    "registry": CURVE_REG,
    "pool_count": n,
    "enumerated": len(pools),
    "qualifying": qualifying,
    "disqualified": disqualified,
    "abi_failures": abi_failures,
}
json.dump(results, open("/tmp/wlaudit/enum.json","w"), indent=2)
print("DONE", flush=True)
print("curve qualifying:", len(qualifying))
print("curve disqualified:", len(disqualified))
print("curve abi_failures:", len(abi_failures))
