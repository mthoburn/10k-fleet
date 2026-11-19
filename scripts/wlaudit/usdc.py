import os, json, urllib.request, urllib.parse, time
from Crypto.Hash import keccak
KEY = os.environ["ETHERSCAN_API_KEY"]
def get(params):
    params = {**params, "apikey": KEY, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.loads(r.read().decode())
def kslot(s):
    k = keccak.new(digest_bits=256); k.update(s.encode()); return "0x" + k.hexdigest()

USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
zos_slot = kslot("org.zeppelinos.proxy.implementation")
print("zos slot =", zos_slot)
r = get({"module":"proxy","action":"eth_getStorageAt","address":USDC,"position":zos_slot,"tag":"latest"})
impl = "0x" + r.get("result","")[-40:]
print("USDC impl via ZOS slot =", impl)
r = get({"module":"contract","action":"getabi","address":impl})
if r.get("status") == "1":
    abi = json.loads(r["result"])
    evts = [e["name"] for e in abi if e.get("type")=="event"]
    matched = [n for n in evts if any(k in n for k in ["Paused","Unpaused","Pause","Unpause","Blacklist","BlackList","Freeze","Frozen"])]
    print(f"  USDC impl events qualifying: {matched}")
else:
    print("getabi FAIL:", r.get("result","")[:200])
