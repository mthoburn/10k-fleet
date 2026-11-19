import os, json, urllib.request, urllib.parse, time
from Crypto.Hash import keccak
KEY = os.environ["ETHERSCAN_API_KEY"]
def get(params):
    params = {**params, "apikey": KEY, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=25) as r:
        return json.loads(r.read().decode())
def throttle(): time.sleep(0.4)
def sel(sig):
    k=keccak.new(digest_bits=256); k.update(sig.encode()); return "0x" + k.hexdigest()[:8]

# TUSD + Lido: implementation() = 0x5c60da1b
# Comp V2 Unitroller: comptrollerImplementation()
print("sel implementation():", sel("implementation()"))
print("sel comptrollerImplementation():", sel("comptrollerImplementation()"))

cases = [
    ("TUSD",        "0x0000000000085d4780B73119b644AE5ecd22b376", sel("implementation()")),
    ("Lido stETH",  "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", sel("implementation()")),
    ("Comp V2 Comptroller", "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B", sel("comptrollerImplementation()")),
]
# Extended QUAL rule
QUAL = set(["Paused","Unpaused","Pause","Unpause","Blacklisted","UnBlacklisted","Blacklist","UnBlacklist","AddedBlackList","RemovedBlackList","DestroyedBlackFunds","Freeze","Unfreeze","Frozen","Unfrozen","FrozenFunds","AddressFrozen","AddressUnfrozen","AddressThawed","FreezeAddress","UnfreezeAddress","FrozenAddressWiped","ReservePaused","ReserveUnpaused","ReserveFrozen","ReserveActive","EmergencyShutdown","Killed","SetKilled","SetPaused","SetEmergency","ActionPaused","MarketPaused","MarketListed","MarketUnlisted","MarketDelisted","MarketExited","NewPauseGuardian","SanctionedAddressListUpdate"])

out = {}
for name, addr, selector in cases:
    r = get({"module":"proxy","action":"eth_call","to":addr,"data":selector,"tag":"latest"}); throttle()
    h = r.get("result","")
    impl = "0x" + h[-40:] if h and len(h)>=42 else None
    if not impl or impl == "0x"+"0"*40:
        print(f"{name}: impl resolve FAIL (result={h[:80]})"); 
        out[name]={"addr":addr,"impl":None,"verdict":"impl_unresolved"}; continue
    rr = get({"module":"contract","action":"getabi","address":impl}); throttle()
    if rr.get("status")!="1":
        print(f"{name}: impl={impl} getabi FAIL ({rr.get('result','')[:60]})")
        out[name]={"addr":addr,"impl":impl,"verdict":"abi_unavailable","getabi_err":rr.get("result","")[:120]}; continue
    abi = json.loads(rr["result"])
    events = sorted({e["name"] for e in abi if e.get("type")=="event"})
    matched = [e for e in events if e in QUAL]
    out[name]={"addr":addr,"impl":impl,"all_events":events,"matched_events":matched,"verdict":"qualifies" if matched else "no_qualifying_event"}
    print(f"{name}: impl={impl}  matched={matched}  n_events={len(events)}")
json.dump(out, open("/tmp/wlaudit/anchors2.json","w"), indent=2)
