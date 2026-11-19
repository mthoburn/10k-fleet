import os, json, urllib.request, urllib.parse, time
from Crypto.Hash import keccak
KEY = os.environ["ETHERSCAN_API_KEY"]
def get(params):
    params = {**params, "apikey": KEY, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=25) as r:
        return json.loads(r.read().decode())
def throttle(): time.sleep(0.4)
def kslot(s):
    k = keccak.new(digest_bits=256); k.update(s.encode()); return "0x" + k.hexdigest()
EIP1967 = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
ZOS = kslot("org.zeppelinos.proxy.implementation")
OZ_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"  # EIP-1967 admin
def resolve_impl(addr):
    for label, slot in [("EIP1967", EIP1967), ("ZOS", ZOS)]:
        r = get({"module":"proxy","action":"eth_getStorageAt","address":addr,"position":slot,"tag":"latest"}); throttle()
        h = r.get("result","")
        if h and len(h)>=42:
            a = "0x" + h[-40:]
            if a != "0x" + "0"*40: return a, label
    return None, None

anchors = [
    ("BUSD",              "0x4Fabb145d64652a948d72533023f6E7A623C7C53"),
    ("USDP",              "0x8E870D67F660D95d5be530380D0eC0bd388289E1"),
    ("TUSD",              "0x0000000000085d4780B73119b644AE5ecd22b376"),
    ("Aave V2 LendingPool","0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9"),
    ("Lido stETH",        "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"),
    ("Compound V2 Comptroller","0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B"),
]
QUAL = ["Paused","Unpaused","Pause","Unpause","Blacklisted","UnBlacklisted","Blacklist","UnBlacklist","AddedBlackList","RemovedBlackList","DestroyedBlackFunds","Freeze","Unfreeze","Frozen","Unfrozen","FrozenFunds","AddressFrozen","AddressThawed","ReservePaused","ReserveUnpaused","ReserveFrozen","ReserveActive","EmergencyShutdown","Killed","SetKilled","SetPaused","SetEmergency","ActionPaused","MarketListed","ActionPausedMarket"]

out = {}
for name, addr in anchors:
    impl, slot = resolve_impl(addr)
    probe = impl or addr
    r = get({"module":"contract","action":"getabi","address":probe}); throttle()
    status = r.get("status")
    if status != "1":
        out[name] = {"addr": addr, "impl": impl, "proxy_slot": slot,
                     "getabi_err": r.get("result","")[:120], "verdict":"abi_unavailable"}
        print(f"{name}: ABI unavailable ({r.get('result','')[:60]})")
        continue
    abi = json.loads(r["result"])
    events = sorted({e["name"] for e in abi if e.get("type")=="event"})
    matched = [e for e in events if e in QUAL]
    # Admin-like fns for context
    funcs = sorted({e["name"] for e in abi if e.get("type")=="function"})
    admin_like = [f for f in funcs if any(k in f.lower() for k in ["paus","blacklist","black","freeze","deprecat","emergency","kill","shutdown","setpauseguardian"])]
    out[name] = {
        "addr": addr, "impl": impl, "proxy_slot": slot,
        "all_events": events,
        "matched_events": matched,
        "admin_like_funcs": admin_like,
        "verdict": "qualifies" if matched else "no_qualifying_event",
    }
    print(f"{name}: matched={matched}  admin_fns={admin_like[:6]}")
json.dump(out, open("/tmp/wlaudit/anchors.json","w"), indent=2)
