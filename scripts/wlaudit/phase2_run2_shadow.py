#!/usr/bin/env python3
"""
Phase 2 run #2 retrospective shadow log.

Reconstructs — AFTER the window closed — every qualifying blacklist
event on ETH USDT + Tron USDT inside the exact detector window
[2026-11-18T18:15:34Z, 2026-11-19T18:15:56Z], checks each against the
pinned dormant fleet, and emits a JSON + md summary.

Nothing is processed live. No catch. No Nosana. $0.

Shared keys: Etherscan at <= 1 call / 2s, TronGrid at <= 2 calls / s.
"""
import os, json, time, hashlib, urllib.request, urllib.parse, datetime, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EK = os.environ["ETHERSCAN_API_KEY"]
TK = os.environ["TRONGRID_API_KEY"]

# ---- window ----
WIN_START_ISO = "2026-11-18T18:15:34Z"
WIN_CLOSE_ISO = "2026-11-19T18:15:56Z"
WIN_START_S = int(datetime.datetime.strptime(WIN_START_ISO, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp())
WIN_CLOSE_S = int(datetime.datetime.strptime(WIN_CLOSE_ISO, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp())
WIN_START_MS = WIN_START_S * 1000
WIN_CLOSE_MS = WIN_CLOSE_S * 1000

ETH_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
ETH_FINALITY_DEPTH = 64

# event topic0 (keccak) — precomputed to avoid pulling a crypto dep
TOPIC_ADDED      = "0x42e160154868087d6bfdc0ca23d96a1c1cfa32f1b72ba9ba27b69b98a0d819dc"  # AddedBlackList(address)
TOPIC_REMOVED    = "0xd7e9ec6e6ecd65492dce6bf513cd6867560d49544421d0783ddf06e76c24470c"  # RemovedBlackList(address)
TOPIC_DESTROYED  = "0x61e6e66b0d6339b2980aecc6ccc0039736791f0ccde9ed512e789a7fbdd698c6"  # DestroyedBlackFunds(address,uint256)

# ---- http ----
ETH_LAST = [0.0]
TRON_LAST = [0.0]

def eth_throttle():
    # >= 2.0s between calls
    dt = time.time() - ETH_LAST[0]
    if dt < 2.05:
        time.sleep(2.05 - dt)
    ETH_LAST[0] = time.time()

def tron_throttle():
    # >= 0.5s between calls
    dt = time.time() - TRON_LAST[0]
    if dt < 0.55:
        time.sleep(0.55 - dt)
    TRON_LAST[0] = time.time()

def eget(params):
    eth_throttle()
    p = {**params, "apikey": EK, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(p)
    with urllib.request.urlopen(url, timeout=40) as r:
        return json.loads(r.read().decode())

def block_by_ts(ts, closest):
    r = eget({"module":"block","action":"getblocknobytime","timestamp":str(ts),"closest":closest})
    return int(r["result"])

def eth_head():
    r = eget({"module":"proxy","action":"eth_blockNumber"})
    return int(r["result"], 16)

def eth_getlogs(topic0, from_b, to_b):
    out = []
    page = 1
    while True:
        r = eget({"module":"logs","action":"getLogs","address":ETH_USDT,
                  "fromBlock":str(from_b),"toBlock":str(to_b),
                  "topic0":topic0,"page":str(page),"offset":"1000"})
        res = r.get("result")
        if isinstance(res, str):
            msg = (r.get("message") or "") + " " + res
            if "No records" in msg or r.get("status") == "0":
                break
            raise RuntimeError(f"etherscan err topic={topic0} {r}")
        out.extend(res)
        if len(res) < 1000:
            break
        page += 1
    return out

def block_ts(block_num):
    r = eget({"module":"block","action":"getblockreward","blockno":str(block_num)})
    return int(r["result"]["timeStamp"])

def tget(path, params):
    tron_throttle()
    url = f"https://api.trongrid.io{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"TRON-PRO-API-KEY": TK})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode())

def tron_events(event_name):
    out = []
    fingerprint = None
    while True:
        params = {"event_name": event_name, "limit": "200",
                  "order_by": "block_timestamp,asc",
                  "min_block_timestamp": str(WIN_START_MS),
                  "max_block_timestamp": str(WIN_CLOSE_MS)}
        if fingerprint:
            params["fingerprint"] = fingerprint
        d = tget(f"/v1/contracts/{TRON_USDT}/events", params)
        chunk = d.get("data", [])
        out.extend(chunk)
        meta = d.get("meta") or {}
        fingerprint = meta.get("fingerprint")
        if not fingerprint or not chunk:
            break
    return out

# ---- decode helpers ----
def eth_addr_from_log(log):
    # USDT params are NOT indexed — address lives in data (first 32-byte word).
    data = log.get("data", "")
    if data and data.startswith("0x") and len(data) >= 66:
        return "0x" + data[2:66][-40:].lower()
    tops = log.get("topics") or []
    if len(tops) >= 2 and tops[1]:
        return "0x" + tops[1][-40:].lower()
    return None

def tron_addr_from_evt(evt):
    r = evt.get("result") or {}
    base58 = None
    hex_addr = None
    for k, v in r.items():
        if not isinstance(v, str):
            continue
        if v.startswith("T") and len(v) == 34:
            base58 = v
        elif v.startswith("41") and len(v) == 42:
            hex_addr = "0x" + v[2:].lower()
        elif v.startswith("0x") and len(v) == 42:
            hex_addr = v.lower()
    return base58, hex_addr

# ---- main ----
def main():
    # verify pinned hash
    pin_path = ROOT / "docs/evidence/dormant-fleet-usdt-enriched.json"
    pin_sha = hashlib.sha256(pin_path.read_bytes()).hexdigest()
    expected = "bcd1edb34c4d5e43ac1a635f92a39d45fc17ce7aca7d7859b6fb5fef3c7038d7"
    if pin_sha != expected:
        raise SystemExit(f"dormant-fleet pin hash mismatch: {pin_sha}")
    fleet = json.loads(pin_path.read_text())
    eth_fleet = set()
    tron_fleet_b58 = set()
    tron_fleet_hex = set()
    for r in fleet["rows"]:
        if r["chain"] == "eth":
            eth_fleet.add(r["address"].lower())
        else:
            if r.get("tron_base58"): tron_fleet_b58.add(r["tron_base58"])
            if r.get("address"):     tron_fleet_hex.add(r["address"].lower())
    print(f"dormant-fleet: eth={len(eth_fleet)} tron_b58={len(tron_fleet_b58)}", flush=True)

    # --- ETH window → block range ---
    print("eth: resolving block range…", flush=True)
    b_from = block_by_ts(WIN_START_S, "after")
    b_to   = block_by_ts(WIN_CLOSE_S, "before")
    head   = eth_head()
    finality_floor = head - ETH_FINALITY_DEPTH
    print(f"eth: blocks {b_from}..{b_to}  head={head}  finality_floor={finality_floor}", flush=True)

    eth_events = {}
    for label, topic in [("AddedBlackList", TOPIC_ADDED),
                         ("RemovedBlackList", TOPIC_REMOVED),
                         ("DestroyedBlackFunds", TOPIC_DESTROYED)]:
        print(f"eth: getLogs {label}", flush=True)
        logs = eth_getlogs(topic, b_from, b_to)
        print(f"  -> {len(logs)} raw", flush=True)
        eth_events[label] = logs

    # --- Tron events ---
    tron_events_all = {}
    for name in ("AddedBlackList", "RemovedBlackList", "DestroyedBlackFunds"):
        print(f"tron: events {name}", flush=True)
        evs = tron_events(name)
        print(f"  -> {len(evs)} raw", flush=True)
        tron_events_all[name] = evs

    # --- build structured rows ---
    qualifying = []  # RemovedBlackList + DestroyedBlackFunds only
    births = []      # AddedBlackList (context)
    finality_flags = []

    for label, logs in eth_events.items():
        for l in logs:
            tx = l.get("transactionHash")
            li = int(l.get("logIndex","0x0"),16) if str(l.get("logIndex","")).startswith("0x") else l.get("logIndex")
            blk = int(l.get("blockNumber","0x0"),16) if str(l.get("blockNumber","")).startswith("0x") else l.get("blockNumber")
            ts = int(l.get("timeStamp","0x0"),16) if str(l.get("timeStamp","")).startswith("0x") else int(l.get("timeStamp") or 0)
            addr = eth_addr_from_log(l)
            in_fleet = addr in eth_fleet if addr else False
            row = {
                "chain": "eth",
                "contract": ETH_USDT,
                "event": label,
                "tx": tx,
                "log_index": li,
                "block": blk,
                "block_time_utc": datetime.datetime.utcfromtimestamp(ts).isoformat()+"Z" if ts else None,
                "wallet_hex": addr,
                "in_dormant_fleet": in_fleet,
            }
            if label == "AddedBlackList":
                births.append(row)
            else:
                qualifying.append(row)
                if blk is not None and blk > finality_floor:
                    finality_flags.append({"tx": tx, "block": blk, "blocks_from_close": head - blk})

    for label, evs in tron_events_all.items():
        for e in evs:
            b58, hx = tron_addr_from_evt(e)
            in_fleet = (b58 in tron_fleet_b58) if b58 else False
            if not in_fleet and hx:
                in_fleet = hx in tron_fleet_hex
            ts_ms = e.get("block_timestamp")
            row = {
                "chain": "tron",
                "contract": TRON_USDT,
                "event": label,
                "tx": e.get("transaction_id"),
                "event_index": e.get("event_index"),
                "block": e.get("block_number"),
                "block_time_utc": datetime.datetime.utcfromtimestamp(ts_ms/1000).isoformat()+"Z" if ts_ms else None,
                "wallet_tron_base58": b58,
                "wallet_hex": hx,
                "in_dormant_fleet": in_fleet,
            }
            if label == "AddedBlackList":
                births.append(row)
            else:
                qualifying.append(row)

    # counts
    def by(key_vals, chain, event):
        return sum(1 for r in key_vals if r["chain"] == chain and r["event"] == event)

    counts_qualifying = {
        "eth_RemovedBlackList": by(qualifying, "eth", "RemovedBlackList"),
        "eth_DestroyedBlackFunds": by(qualifying, "eth", "DestroyedBlackFunds"),
        "tron_RemovedBlackList": by(qualifying, "tron", "RemovedBlackList"),
        "tron_DestroyedBlackFunds": by(qualifying, "tron", "DestroyedBlackFunds"),
    }
    counts_births = {
        "eth_AddedBlackList": by(births, "eth", "AddedBlackList"),
        "tron_AddedBlackList": by(births, "tron", "AddedBlackList"),
    }
    misses = [r for r in qualifying if r["in_dormant_fleet"]]

    out = {
        "label": "RETROSPECTIVE: reconstructed from chain after the window; nothing was processed live (no catch).",
        "attribution": "Census data powered by Etherscan",
        "window_utc": {"start": WIN_START_ISO, "close": WIN_CLOSE_ISO},
        "detector_outcome": "no qualifying event; no job posted",
        "chains": {
            "eth_usdt": {"contract": ETH_USDT,
                         "block_range": {"from": b_from, "to": b_to},
                         "head_at_audit": head,
                         "finality_depth_blocks": ETH_FINALITY_DEPTH,
                         "finality_floor_block": finality_floor},
            "tron_usdt": {"contract": TRON_USDT},
        },
        "dormant_fleet_pin": {
            "path": "docs/evidence/dormant-fleet-usdt-enriched.json",
            "sha256": expected,
            "eth_count": len(eth_fleet),
            "tron_count": len(tron_fleet_b58),
        },
        "qualifying_counts": counts_qualifying,
        "qualifying_total": len(qualifying),
        "detector_miss_count": len(misses),
        "detector_misses": misses,
        "qualifying_events": qualifying,
        "context_births_in_window": counts_births,
        "context_births": births,
        "eth_finality_flags_qualifying_inside_last_64_blocks": finality_flags,
    }
    out_path = ROOT / "docs/evidence/phase2-run2-shadow-log.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"wrote {out_path}", flush=True)
    print(json.dumps({"qualifying": counts_qualifying,
                      "births": counts_births,
                      "misses": len(misses)}, indent=2))

if __name__ == "__main__":
    main()
