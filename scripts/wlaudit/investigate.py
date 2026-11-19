import os, json, urllib.request, urllib.parse, time
from Crypto.Hash import keccak
EK=os.environ["ETHERSCAN_API_KEY"]; TK=os.environ["TRONGRID_API_KEY"]
def kk(s): k=keccak.new(digest_bits=256); k.update(s.encode()); return "0x"+k.hexdigest()
def eget(p):
    p={**p,"apikey":EK,"chainid":1}
    with urllib.request.urlopen("https://api.etherscan.io/v2/api?"+urllib.parse.urlencode(p),timeout=30) as r:
        return json.loads(r.read().decode())
def thr(): time.sleep(0.4)

# --- ETH_USDT: fetch ALL AddedBlackList logs, find the near-zero ones and pull their tx inputs ---
USDT="0xdAC17F958D2ee523a2206206994597C13D831ec7"
t0=kk("AddedBlackList(address)")
head=int(eget({"module":"proxy","action":"eth_blockNumber"})["result"],16); thr()
# pagination
logs=[]
page=1
while True:
    r=eget({"module":"logs","action":"getLogs","address":USDT,"fromBlock":"4634748","toBlock":str(head),
            "topic0":t0,"page":str(page),"offset":"1000"}); thr()
    if isinstance(r.get("result"),str): break
    ch=r.get("result",[])
    logs.extend(ch)
    if len(ch)<1000 or page>=10: break
    page+=1
print(f"ETH_USDT AddedBlackList logs fetched: {len(logs)}")

def decode_data0(data):
    return "0x"+data[2:66][-40:].lower() if data and len(data)>=66 else None

near=[l for l in logs if decode_data0(l.get("data"))
       and decode_data0(l["data"])[2:22]=="0"*20]
print(f"  near-zero (lead-10-bytes zero): {len(near)}")

# For each near-zero, fetch transaction input
sel_add=kk("addBlackList(address)")[:10]
sel_destroy=kk("destroyBlackFunds(address)")[:10]
print(f"  function selectors: addBlackList={sel_add}  destroyBlackFunds={sel_destroy}")
verdicts=[]
for i,l in enumerate(near):
    tx=l["transactionHash"]
    r=eget({"module":"proxy","action":"eth_getTransactionByHash","txhash":tx}); thr()
    txo=r.get("result") or {}
    inp=txo.get("input","")
    frm=txo.get("from",""); to=txo.get("to","")
    event_addr = decode_data0(l["data"])
    # function selector = first 4 bytes of input (8 hex + '0x')
    fn_sel = inp[:10].lower() if inp else ""
    # arg0 = next 32 bytes, address = last 20
    arg0 = "0x"+inp[10:74][-40:].lower() if len(inp)>=74 else None
    match = (arg0 == event_addr)
    verdicts.append({"tx":tx,"block":int(l["blockNumber"],16),
                     "event_addr":event_addr,"tx_from":frm,"tx_to":to,
                     "fn_sel":fn_sel,"tx_arg0":arg0,"match":match,"input_len":len(inp)})
    if i<5 or not match:
        print(f"    #{i}: tx={tx[:20]}... event={event_addr} fn_sel={fn_sel} arg0={arg0} match={match}")
n_match=sum(1 for v in verdicts if v["match"])
print(f"\n  ETH_USDT near-zero: {len(verdicts)} total, {n_match} have matching input arg (admin DID call with this addr)")
by_sel = {}
for v in verdicts: by_sel.setdefault(v["fn_sel"],0); by_sel[v["fn_sel"]]+=1
print(f"  by function selector: {by_sel}")
# sample admins
senders = {}
for v in verdicts: senders[v["tx_from"]] = senders.get(v["tx_from"],0)+1
print(f"  distinct senders (admin addresses): {senders}")

# --- Tron_USDT similar check via TronGrid ---
# TronGrid returns transaction info via /wallet/gettransactioninfobyid — need the raw call data
# Simpler: for Tron we trust TronGrid's auto-decoded `result` field. But the reviewer's concern is
# decoder error on OUR side; TronGrid decodes using the contract ABI, so if _user came back
# as 0x...1896 that's what the on-chain event param was. No "wrong 32-byte word" risk on Tron
# since we read the named param by key.
# Still, cross-check by pulling the raw transaction for 1-2 samples to see admin input.

TRON_USDT_B58="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
def tron_events(addr,name,pages=5,limit=200):
    out=[]; fp=None
    for _ in range(pages):
        p={"event_name":name,"limit":str(limit),"order_by":"block_timestamp,asc"}
        if fp: p["fingerprint"]=fp
        req=urllib.request.Request(f"https://api.trongrid.io/v1/contracts/{addr}/events?"+urllib.parse.urlencode(p),
                                   headers={"TRON-PRO-API-KEY":TK})
        with urllib.request.urlopen(req,timeout=30) as r:
            d=json.loads(r.read().decode())
        out.extend(d.get("data",[]))
        fp=(d.get("meta") or {}).get("fingerprint")
        if not fp: break
        time.sleep(0.1)
    return out

tron_evts=tron_events(TRON_USDT_B58,"AddedBlackList",pages=4,limit=200)
tron_near=[]
for e in tron_evts:
    res=e.get("result") or {}
    u=res.get("_user") or res.get("user") or res.get("0")
    if u and u.startswith("0x") and u[2:22]=="0"*20:
        tron_near.append({"tx":e.get("transaction_id"),"block":e.get("block_number"),"result":res})
print(f"\nTron_USDT near-zero in first {len(tron_evts)} events: {len(tron_near)}")
for s in tron_near[:3]:
    print(f"  tx={s['tx']} block={s['block']} result={s['result']}")
# Pull one tx info
if tron_near:
    txid=tron_near[0]["tx"]
    req=urllib.request.Request("https://api.trongrid.io/wallet/gettransactioninfobyid",
                               data=json.dumps({"value":txid}).encode(),
                               headers={"TRON-PRO-API-KEY":TK,"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=30) as r:
        info=json.loads(r.read().decode())
    cr=info.get("contract_result") or []
    lg=info.get("log") or []
    print(f"\n  Tron tx {txid} info: fee={info.get('fee')} log_count={len(lg)}")
    for L in lg[:2]:
        print(f"    log topics_n={len(L.get('topics',[]))} data_len={len(L.get('data','') or '')} first_topic={L.get('topics',[None])[0][:20] if L.get('topics') else None}")

json.dump({"eth_usdt_near_zero_verdicts":verdicts,
          "tron_usdt_near_zero_samples":tron_near[:10]},
         open("/tmp/wlaudit/investigate.json","w"), indent=2)
print("\nwrote /tmp/wlaudit/investigate.json")
