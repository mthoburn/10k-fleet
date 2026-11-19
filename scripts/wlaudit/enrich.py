import os, json, urllib.request, urllib.parse, time, datetime
from Crypto.Hash import keccak
EK=os.environ["ETHERSCAN_API_KEY"]; TK=os.environ["TRONGRID_API_KEY"]
def kk(s): k=keccak.new(digest_bits=256); k.update(s.encode()); return "0x"+k.hexdigest()
def eget(p):
    p={**p,"apikey":EK,"chainid":1}
    with urllib.request.urlopen("https://api.etherscan.io/v2/api?"+urllib.parse.urlencode(p),timeout=40) as r:
        return json.loads(r.read().decode())
def thr(): time.sleep(0.4)

CONTRACT_INFO = {
    "ETH_USDT": {"chain":"eth","addr":"0xdAC17F958D2ee523a2206206994597C13D831ec7","event":"AddedBlackList(address)","deploy":4634748,"indexed":False},
    "ETH_USDC": {"chain":"eth","addr":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","event":"Blacklisted(address)","deploy":6082465,"indexed":True},
    "BUSD":     {"chain":"eth","addr":"0x4Fabb145d64652a948d72533023f6E7A623C7C53","event":"AddressFrozen(address)","deploy":8493709,"indexed":True},
    "USDP":     {"chain":"eth","addr":"0x8E870D67F660D95d5be530380D0eC0bd388289E1","event":"FreezeAddress(address)","deploy":14653265,"indexed":True},
    "TUSD":     {"chain":"eth","addr":"0x0000000000085d4780B73119b644AE5ecd22b376","event":"Blacklisted(address)","deploy":11506213,"indexed":True},
    "TRON_USDT":{"chain":"tron","addr":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","event":"AddedBlackList"},
    "TRON_USDC":{"chain":"tron","addr":"TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8","event":"Blacklisted"},
}

def eth_all_adds(cname, info):
    head=int(eget({"module":"proxy","action":"eth_blockNumber"})["result"],16); thr()
    t0=kk(info["event"])
    out=[]; page=1
    while True:
        r=eget({"module":"logs","action":"getLogs","address":info["addr"],
                "fromBlock":str(info["deploy"]),"toBlock":str(head),
                "topic0":t0,"page":str(page),"offset":"1000"}); thr()
        if isinstance(r.get("result"),str): break
        ch=r.get("result",[])
        out.extend(ch)
        if len(ch)<1000 or page>=10: break
        page+=1
    print(f"  {cname}: fetched {len(out)} add events")
    m={}
    for l in out:
        topics=l.get("topics",[])
        data=l.get("data","")
        if info["indexed"] and len(topics)>=2:
            w="0x"+topics[1][-40:].lower()
        elif data and len(data)>=66:
            w="0x"+data[2:66][-40:].lower()
        else: continue
        def _h(v):
            if not v or v=="0x": return 0
            try: return int(v,16)
            except: return 0
        ts=_h(l.get("timeStamp",""))
        blk=_h(l.get("blockNumber",""))
        rec={"tx":l["transactionHash"],"block":blk,"ts_unix":ts,"log_index":_h(l.get("logIndex",""))}
        if w not in m or rec["ts_unix"]<m[w]["ts_unix"] or (rec["ts_unix"]==m[w]["ts_unix"] and rec["block"]<m[w]["block"]):
            m[w]=rec
    return m

def tron_all_adds(cname, info):
    addr=info["addr"]; name=info["event"]
    out=[]; fp=None
    while True:
        p={"event_name":name,"limit":"200","order_by":"block_timestamp,asc"}
        if fp: p["fingerprint"]=fp
        req=urllib.request.Request(f"https://api.trongrid.io/v1/contracts/{addr}/events?"+urllib.parse.urlencode(p),
                                   headers={"TRON-PRO-API-KEY":TK})
        with urllib.request.urlopen(req,timeout=40) as r:
            d=json.loads(r.read().decode())
        out.extend(d.get("data",[]))
        fp=(d.get("meta") or {}).get("fingerprint")
        if not fp: break
        time.sleep(0.08)
    print(f"  {cname}: fetched {len(out)} add events")
    m={}
    for e in out:
        res=e.get("result") or {}
        u=res.get("_user") or res.get("_account") or res.get("account") or res.get("0")
        if not u: continue
        ts=e.get("block_timestamp")
        rec={"tx":e.get("transaction_id"),"block":e.get("block_number"),"ts_ms":ts,"event_index":e.get("event_index")}
        if u not in m or rec["ts_ms"]<m[u]["ts_ms"]:
            m[u]=rec
    return m

sample=json.load(open("docs/evidence/dormant-sample-500.json"))
rows=sample["rows"]
contracts_in_sample={r["source_contract"] for r in rows}
print("contracts in sample:", sorted(contracts_in_sample))

maps={}
for cname in sorted(contracts_in_sample):
    info=CONTRACT_INFO[cname]
    print(f"building map for {cname}...")
    maps[cname]=eth_all_adds(cname,info) if info["chain"]=="eth" else tron_all_adds(cname,info)
    print(f"  distinct wallets with freeze record: {len(maps[cname])}")

# Census for consistency check
census=json.load(open("docs/evidence/watchlist-30d-counts.json"))["census"]
cf_sets={k: set(a.lower() if isinstance(a,str) and a.startswith("0x") else a for a in v["addresses"]["currently_frozen"]) for k,v in census.items()}
at_sets={k: set(a.lower() if isinstance(a,str) and a.startswith("0x") else a for a in v["addresses"]["all_time_added"]) for k,v in census.items()}

enriched=[]; unresolved=[]
for r in rows:
    cname=r["source_contract"]; addr=r["address"]
    info=CONTRACT_INFO[cname]
    m=maps[cname]
    new=dict(r)
    rec=m.get(addr)
    if rec:
        if info["chain"]=="eth":
            new["freeze_tx"]=rec["tx"]
            new["freeze_block"]=rec["block"]
            new["frozen_at"]=datetime.datetime.utcfromtimestamp(rec["ts_unix"]).isoformat()+"Z" if rec["ts_unix"] else None
            if not rec["ts_unix"]:
                unresolved.append({"source_contract":cname,"address":addr,"reason":"log_returned_without_timestamp","fix":"re-query getLogs or use getBlockByNumber"})
        else:
            new["freeze_tx"]=rec["tx"]
            new["freeze_block"]=rec["block"]
            new["frozen_at"]=datetime.datetime.utcfromtimestamp(rec["ts_ms"]/1000).isoformat()+"Z" if rec["ts_ms"] else None
            if not rec["ts_ms"]:
                unresolved.append({"source_contract":cname,"address":addr,"reason":"tron_event_missing_block_timestamp","fix":"re-query event or fetch transaction info"})
    else:
        # Classify why
        in_cf=addr in cf_sets.get(cname,set())
        in_at=addr in at_sets.get(cname,set())
        if not in_cf and not in_at:
            reason="not_in_census_at_all"
        elif in_cf and not in_at:
            reason="census_join_bug_in_cf_but_not_in_added"
        elif in_at and not in_cf:
            reason="in_added_but_not_currently_frozen_contradicts_sample_source"
        else:
            reason="map_miss_despite_being_in_census_added"
        unresolved.append({"source_contract":cname,"address":addr,"reason":reason,
                           "in_currently_frozen":in_cf,"in_all_time_added":in_at})
    enriched.append(new)

resolved=sum(1 for e in enriched if e.get("freeze_tx") and e.get("frozen_at"))
print(f"\nresolved with freeze_tx + frozen_at: {resolved}/{len(enriched)}")
print(f"unresolved: {len(unresolved)}")
for u in unresolved[:20]:
    print("  ", u)

out={
    "generated_at_utc": datetime.datetime.utcnow().isoformat()+"Z",
    "source_file": "docs/evidence/dormant-sample-500.json",
    "enrichment": {
        "freeze_tx": "hash of the earliest AddedBlackList / Blacklisted / AddressFrozen / FreezeAddress event emitted by the source contract that names this wallet. Tron txs are hex (as TronGrid returns).",
        "freeze_block": "block number of that event.",
        "frozen_at": "ISO 8601 UTC timestamp of the freeze block. Omitted (null) if the on-chain record did not supply a timestamp; such rows are also listed in `unresolved` with a reason."
    },
    "method": "Full-history paginated event scan per source contract (Etherscan V2 logs/getLogs for ETH, TronGrid v1/contracts/{addr}/events for Tron); wallet-indexed; earliest timestamp kept.",
    "sample_size": len(enriched),
    "resolved_count": resolved,
    "unresolved_count": len(unresolved),
    "unresolved": unresolved,
    "rows": enriched,
}
with open("docs/evidence/dormant-sample-500-enriched.json","w") as f:
    json.dump(out,f,indent=2)
print(f"wrote docs/evidence/dormant-sample-500-enriched.json bytes={os.path.getsize('docs/evidence/dormant-sample-500-enriched.json')}")
