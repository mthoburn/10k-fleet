import os, json, urllib.request, urllib.parse, time, datetime
from Crypto.Hash import keccak
EK=os.environ["ETHERSCAN_API_KEY"]; TK=os.environ["TRONGRID_API_KEY"]
def kk(s): k=keccak.new(digest_bits=256); k.update(s.encode()); return "0x"+k.hexdigest()
def eget(p):
    p={**p,"apikey":EK,"chainid":1}
    with urllib.request.urlopen("https://api.etherscan.io/v2/api?"+urllib.parse.urlencode(p),timeout=25) as r:
        return json.loads(r.read().decode())
def thr(): time.sleep(0.4)

# For each event-type, pull one sample log and record (tx, block, log_index, expected wallet, decode_path)
contracts = [
    # (chain, name, addr, event_sig, decode_path, from_block)
    ("eth","ETH_USDT","0xdAC17F958D2ee523a2206206994597C13D831ec7","AddedBlackList(address)","data_word0",4634748),
    ("eth","ETH_USDT","0xdAC17F958D2ee523a2206206994597C13D831ec7","RemovedBlackList(address)","data_word0",4634748),
    ("eth","ETH_USDT","0xdAC17F958D2ee523a2206206994597C13D831ec7","DestroyedBlackFunds(address,uint256)","data_word0",4634748),
    ("eth","ETH_USDC","0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","Blacklisted(address)","topics1",6082465),
    ("eth","ETH_USDC","0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","UnBlacklisted(address)","topics1",6082465),
    ("eth","BUSD","0x4Fabb145d64652a948d72533023f6E7A623C7C53","AddressFrozen(address)","topics1",8493709),
    ("eth","BUSD","0x4Fabb145d64652a948d72533023f6E7A623C7C53","AddressUnfrozen(address)","topics1",8493709),
    ("eth","USDP","0x8E870D67F660D95d5be530380D0eC0bd388289E1","FreezeAddress(address)","auto",14653265),
]

head=int(eget({"module":"proxy","action":"eth_blockNumber"})["result"],16); thr()

fixtures=[]
for chain,cname,addr,sig,path,fb in contracts:
    t0=kk(sig)
    r=eget({"module":"logs","action":"getLogs","address":addr,"fromBlock":str(fb),"toBlock":str(head),
            "topic0":t0,"page":"1","offset":"3"}); thr()
    if isinstance(r.get("result"),str) or not r.get("result"):
        fixtures.append({"chain":chain,"contract":cname,"event":sig,"status":"no_events"}); continue
    l=r["result"][0]
    topics=l.get("topics",[])
    data=l.get("data","")
    # Decode expected wallet
    expected=None; actual_path=None
    if len(topics)>=2 and topics[1] and len(topics[1])>=42:
        expected="0x"+topics[1][-40:].lower(); actual_path="topics1"
    elif data and len(data)>=66:
        expected="0x"+data[2:66][-40:].lower(); actual_path="data_word0"
    fixtures.append({
        "chain":chain,"contract":cname,"contract_address":addr.lower(),
        "event":sig,"topic0":t0,
        "tx_hash":l["transactionHash"],"block":int(l["blockNumber"],16),"log_index":int(l["logIndex"],16),
        "topics_count":len(topics),"data_length_hex":len(data)-2,
        "expected_wallet":expected,"decode_path":actual_path,
        "note":"golden fixture: decoder must yield expected_wallet"
    })
    print(f"  {cname} {sig}: tx={l['transactionHash'][:12]}... expected={expected} path={actual_path}")

# Add one explicit near-zero fixture to prove decoder-correctness for sentinel case
inv=json.load(open("/tmp/wlaudit/investigate.json"))
is_bl=json.load(open("/tmp/wlaudit/isblacklisted.json"))
# First entry from investigate.json corresponds to the tx+address pair
v0=inv["eth_usdt_near_zero_verdicts"][0]
fixtures.append({
    "chain":"eth","contract":"ETH_USDT","contract_address":"0xdac17f958d2ee523a2206206994597c13d831ec7",
    "event":"AddedBlackList(address)","topic0":kk("AddedBlackList(address)"),
    "tx_hash":v0["tx"],"block":v0["block"],
    "expected_wallet":"0x0000000000000000000000000000000000000000",
    "decode_path":"data_word0",
    "live_isblacklisted_check":True,
    "note":"near-zero sentinel fixture: decoder MUST yield 0x0 here. USDT.isBlackListed(0x0)==true on-chain, proving the log value is what the contract recorded (not a decoder bug)."
})

# Tron fixtures: use TronGrid auto-decode. Pull one sample per Tron event.
def tron_one(addr,name):
    req=urllib.request.Request(f"https://api.trongrid.io/v1/contracts/{addr}/events?event_name={name}&limit=1&order_by=block_timestamp,asc",
                               headers={"TRON-PRO-API-KEY":TK})
    with urllib.request.urlopen(req,timeout=25) as r:
        return json.loads(r.read().decode()).get("data",[])

for addr_b58, cname, name in [
    ("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","TRON_USDT","AddedBlackList"),
    ("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","TRON_USDT","RemovedBlackList"),
    ("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","TRON_USDT","DestroyedBlackFunds"),
    ("TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8","TRON_USDC","Blacklisted"),
]:
    evts=tron_one(addr_b58,name)
    if not evts: fixtures.append({"chain":"tron","contract":cname,"event":name,"status":"no_events"}); continue
    e=evts[0]
    res=e.get("result") or {}
    expected=res.get("_user") or res.get("_account") or res.get("account") or res.get("user") or res.get("addr") or res.get("0")
    fixtures.append({
        "chain":"tron","contract":cname,"contract_address_base58":addr_b58,
        "event":name,
        "tx_hash":e.get("transaction_id"),"block":e.get("block_number"),"event_index":e.get("event_index"),
        "expected_wallet":expected,
        "decode_path":"trongrid_abi_named_param",
        "result_keys":sorted(res.keys()),
        "note":"golden fixture: watcher reads named param by ABI, not positionally"
    })
    print(f"  {cname} {name}: tx={e.get('transaction_id','')[:12]}... expected={expected}")
    time.sleep(0.2)

out={
    "generated_at_utc": datetime.datetime.utcnow().isoformat()+"Z",
    "purpose": "Per-event golden decode fixtures for Issue D (on-chain event watcher). Each entry pins a known historical tx/log to the expected subject-wallet the decoder must produce. CI compares decode(fixture) == expected_wallet.",
    "decode_paths": {
        "topics1": "address from topics[1] (last 20 bytes). Used when the event's address param is `indexed`.",
        "data_word0": "address from the first 32-byte word of data (last 20 bytes). Used when the event's address param is non-indexed.",
        "trongrid_abi_named_param": "read the parameter by its ABI name from TronGrid's decoded `result` object. Position-free; works for all Tron events given a correct ABI vendoring."
    },
    "fixtures": fixtures
}
json.dump(out, open("docs/evidence/decode-fixtures.json","w"), indent=2)
print(f"\nwrote docs/evidence/decode-fixtures.json ({len(fixtures)} fixtures)")
