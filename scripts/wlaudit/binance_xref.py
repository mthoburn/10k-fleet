"""
Binance cross-check (Note 1, 18 Nov plan).

Pulls ETH USDT + Tron USDT AddedBlackList events in 2026-10-29 00:00 UTC
.. 2026-10-30 23:59 UTC, joins against the Phase-2 fleet and the
census-seedable set, records historical balance_at_freeze_block, scans
post-freeze DestroyedBlackFunds / RemovedBlackList, and emits 24h/1h
cluster buckets.

Reuse patterns from scripts/wlaudit/{census,enrich,fleet_usdt,longgap}.py.

Output: docs/evidence/binance-xref-29oct2026.json
"""
import os, json, urllib.request, urllib.parse, time, datetime, hashlib, subprocess, sys
import base58
from Crypto.Hash import keccak

EK = os.environ["ETHERSCAN_API_KEY"]
TK = os.environ["TRONGRID_API_KEY"]

ETH_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"

# Window: 2026-10-29 00:00:00 UTC .. 2026-10-30 23:59:59 UTC
WIN_START = int(datetime.datetime(2026, 10, 29, 0, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
WIN_END = int(datetime.datetime(2026, 10, 30, 23, 59, 59, tzinfo=datetime.timezone.utc).timestamp())
# Wider window for 24h / 1h clustering buckets (Oct 27 .. Nov 1 inclusive)
BUCKET_START = int(datetime.datetime(2026, 10, 27, 0, 0, 0, tzinfo=datetime.timezone.utc).timestamp())
BUCKET_END = int(datetime.datetime(2026, 11, 1, 23, 59, 59, tzinfo=datetime.timezone.utc).timestamp())

ETHERSCAN_CALLS = 0
TRONGRID_CALLS = 0

def kk(sig):
    k = keccak.new(digest_bits=256); k.update(sig.encode()); return "0x" + k.hexdigest()

def _h(v):
    if not v or v == "0x": return 0
    try: return int(v, 16)
    except: return 0

def eget(params, _retries=3):
    """Etherscan V2 GET with ~400ms throttle and retry on rate-limit."""
    global ETHERSCAN_CALLS
    params = {**params, "apikey": EK, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(params)
    for attempt in range(_retries):
        ETHERSCAN_CALLS += 1
        try:
            with urllib.request.urlopen(url, timeout=45) as r:
                data = json.loads(r.read().decode())
            # Rate-limit sentinel: message "Max rate limit reached" or similar
            msg = str(data.get("message", "")) + " " + str(data.get("result", ""))
            if "rate limit" in msg.lower() or "Max calls per sec" in msg:
                time.sleep(1.2 * (attempt + 1)); continue
            time.sleep(0.4)
            return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503):
                time.sleep(1.2 * (attempt + 1)); continue
            raise
    time.sleep(0.4)
    return data

def tget(path, params, _retries=3):
    global TRONGRID_CALLS
    for attempt in range(_retries):
        TRONGRID_CALLS += 1
        try:
            req = urllib.request.Request(
                f"https://api.trongrid.io{path}?" + urllib.parse.urlencode(params),
                headers={"TRON-PRO-API-KEY": TK},
            )
            with urllib.request.urlopen(req, timeout=45) as r:
                data = json.loads(r.read().decode())
            time.sleep(0.1)
            return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503):
                time.sleep(1.2 * (attempt + 1)); continue
            raise
    return data

def eth_block_for_ts(ts, closest="after"):
    r = eget({"module": "block", "action": "getblocknobytime",
              "timestamp": str(ts), "closest": closest})
    return int(r["result"])

def to_b58(hex20):
    raw = bytes.fromhex("41" + hex20[2:])
    cs = hashlib.sha256(hashlib.sha256(raw).digest()).digest()[:4]
    return base58.b58encode(raw + cs).decode()

def is_sentinel(a):
    return a.startswith("0x") and a[2:22] == "0" * 20

# -----------------------------------------------------------------------------
# ETH USDT: AddedBlackList in [BUCKET_START, BUCKET_END]
# -----------------------------------------------------------------------------
def fetch_eth_addedblack():
    from_block = eth_block_for_ts(BUCKET_START, "after")
    to_block = eth_block_for_ts(BUCKET_END, "before")
    print(f"ETH blocks for bucket window: {from_block} .. {to_block}")
    t0 = kk("AddedBlackList(address)")
    out = []
    page = 1
    while True:
        r = eget({"module": "logs", "action": "getLogs", "address": ETH_USDT,
                  "fromBlock": str(from_block), "toBlock": str(to_block),
                  "topic0": t0, "page": str(page), "offset": "1000"})
        chunk = r.get("result", [])
        if isinstance(chunk, str):
            break
        out.extend(chunk)
        if len(chunk) < 1000:
            break
        page += 1
        if page > 5:
            break
    seen = set(); rows = []
    for l in out:
        key = (l["transactionHash"], _h(l.get("logIndex", "")))
        if key in seen:
            continue
        seen.add(key)
        data = l.get("data", "")
        if not data or len(data) < 66:
            continue
        w = "0x" + data[2:66][-40:].lower()
        rows.append({
            "chain": "eth",
            "contract": ETH_USDT,
            "wallet": w,
            "freeze_tx": l["transactionHash"],
            "freeze_block": _h(l.get("blockNumber", "")),
            "block_ts_unix": _h(l.get("timeStamp", "")),
            "log_index": _h(l.get("logIndex", "")),
            "is_sentinel": is_sentinel(w),
        })
    rows.sort(key=lambda r: (r["block_ts_unix"], r["freeze_block"], r["log_index"]))
    return rows, from_block, to_block

# -----------------------------------------------------------------------------
# Tron USDT: AddedBlackList in [BUCKET_START*1000, BUCKET_END*1000]
# -----------------------------------------------------------------------------
def fetch_tron_addedblack():
    out = []
    fp = None
    pages = 0
    params_base = {
        "event_name": "AddedBlackList",
        "limit": "200",
        "order_by": "block_timestamp,asc",
        "min_block_timestamp": str(BUCKET_START * 1000),
        "max_block_timestamp": str(BUCKET_END * 1000),
    }
    while True:
        params = dict(params_base)
        if fp:
            params["fingerprint"] = fp
        d = tget(f"/v1/contracts/{TRON_USDT}/events", params)
        out.extend(d.get("data", []))
        fp = (d.get("meta") or {}).get("fingerprint")
        pages += 1
        if not fp or pages >= 20:
            break
    seen = set(); rows = []
    for e in out:
        key = (e.get("transaction_id"), e.get("event_index"))
        if key in seen:
            continue
        seen.add(key)
        res = e.get("result") or {}
        u_hex = res.get("_user") or res.get("0")
        if not u_hex:
            continue
        if not u_hex.startswith("0x"):
            # TronGrid sometimes returns bare hex (41-prefixed or no prefix)
            uh = u_hex.lower()
            if uh.startswith("41") and len(uh) == 42:
                hex20 = "0x" + uh[2:]
            else:
                hex20 = "0x" + uh[-40:]
        else:
            hex20 = "0x" + u_hex[-40:].lower()
        hex20 = hex20.lower()
        b58 = None
        try:
            b58 = to_b58(hex20)
        except Exception:
            b58 = None
        rows.append({
            "chain": "tron",
            "contract": TRON_USDT,
            "wallet": hex20,
            "tron_base58": b58,
            "freeze_tx": e.get("transaction_id"),
            "freeze_block": e.get("block_number"),
            "block_ts_unix": int(e.get("block_timestamp", 0)) // 1000,
            "block_ts_ms": e.get("block_timestamp"),
            "event_index": e.get("event_index"),
            "is_sentinel": is_sentinel(hex20),
        })
    rows.sort(key=lambda r: (r["block_ts_unix"], r["freeze_block"] or 0, r["event_index"] or 0))
    return rows

# -----------------------------------------------------------------------------
# Historical balanceOf for ETH rows (pre-flight first)
# -----------------------------------------------------------------------------
BALANCE_OF_SELECTOR = kk("balanceOf(address)")[:10]  # 0x70a08231

def eth_balance_at(wallet, block_hex):
    data = BALANCE_OF_SELECTOR + "0" * 24 + wallet[2:].lower()
    r = eget({"module": "proxy", "action": "eth_call",
              "to": ETH_USDT, "data": data, "tag": block_hex})
    res = r.get("result")
    if not res or not isinstance(res, str) or not res.startswith("0x"):
        return None, res
    try:
        return int(res, 16), None
    except ValueError:
        return None, res

# -----------------------------------------------------------------------------
# Post-freeze wake scan: DestroyedBlackFunds + RemovedBlackList on same contract
# -----------------------------------------------------------------------------
def fetch_eth_post_events(min_from_block):
    head = _h(eget({"module": "proxy", "action": "eth_blockNumber"})["result"])
    results = []
    for sig in ["DestroyedBlackFunds(address,uint256)",
                "RemovedBlackList(address)"]:
        t0 = kk(sig)
        page = 1
        while True:
            r = eget({"module": "logs", "action": "getLogs", "address": ETH_USDT,
                      "fromBlock": str(min_from_block), "toBlock": str(head),
                      "topic0": t0, "page": str(page), "offset": "1000"})
            chunk = r.get("result", [])
            if isinstance(chunk, str):
                break
            for l in chunk:
                data = l.get("data", "")
                # DestroyedBlackFunds has (address _blackListedUser, uint _balance)
                # RemovedBlackList has (address _user)
                if not data or len(data) < 66:
                    continue
                w = "0x" + data[2:66][-40:].lower()
                results.append({
                    "chain": "eth",
                    "event_name": sig.split("(")[0],
                    "wallet": w,
                    "tx": l["transactionHash"],
                    "block": _h(l.get("blockNumber", "")),
                    "ts_unix": _h(l.get("timeStamp", "")),
                    "log_index": _h(l.get("logIndex", "")),
                })
            if len(chunk) < 1000:
                break
            page += 1
            if page > 10:
                break
    return results, head

def fetch_tron_post_events(min_ts_ms):
    results = []
    for ev in ["DestroyedBlackFunds", "RemovedBlackList"]:
        fp = None; pages = 0
        while True:
            params = {"event_name": ev, "limit": "200",
                      "order_by": "block_timestamp,asc",
                      "min_block_timestamp": str(min_ts_ms)}
            if fp:
                params["fingerprint"] = fp
            d = tget(f"/v1/contracts/{TRON_USDT}/events", params)
            for e in d.get("data", []):
                res = e.get("result") or {}
                u = res.get("_user") or res.get("_blackListedUser") or res.get("0")
                if not u:
                    continue
                hex20 = "0x" + (u.lower()[-40:] if u.startswith("0x") or u.startswith("41") else u.lower()[-40:])
                results.append({
                    "chain": "tron",
                    "event_name": ev,
                    "wallet": hex20,
                    "tx": e.get("transaction_id"),
                    "block": e.get("block_number"),
                    "ts_unix": int(e.get("block_timestamp", 0)) // 1000,
                    "event_index": e.get("event_index"),
                })
            fp = (d.get("meta") or {}).get("fingerprint")
            pages += 1
            if not fp or pages >= 15:
                break
    return results

# -----------------------------------------------------------------------------
# Join sources: phase-2 fleet + census seedable
# -----------------------------------------------------------------------------
def load_phase2_fleet():
    """dormant-fleet-usdt-enriched.json lives on chain-watch/dormant-fleet-usdt branch."""
    try:
        with open("docs/evidence/dormant-fleet-usdt-enriched.json") as f:
            return json.load(f)
    except FileNotFoundError:
        raw = subprocess.check_output(
            ["git", "show",
             "origin/chain-watch/dormant-fleet-usdt:docs/evidence/dormant-fleet-usdt-enriched.json"])
        return json.loads(raw)

def load_census():
    with open("docs/evidence/watchlist-30d-counts.json") as f:
        return json.load(f)["census"]

# =============================================================================
# Main
# =============================================================================
def main():
    print("# Note 1 — Binance cross-check (29–30 Oct 2026 USDT freezes)")
    phase2 = load_phase2_fleet()
    census = load_census()

    phase2_set = {r["address"].lower() for r in phase2["rows"]}
    eth_at = {a.lower() for a in census["ETH_USDT"]["addresses"]["all_time_added"]}
    tron_at = {a.lower() for a in census["TRON_USDT"]["addresses"]["all_time_added"]}
    # census-seedable = 12,732 non-sentinel currently_frozen set across all 7 contracts
    seedable = set()
    for cname, c in census.items():
        for a in c["addresses"].get("currently_frozen", []):
            la = a.lower()
            if not is_sentinel(la):
                seedable.add(la)
    print(f"census seedable (non-sentinel currently_frozen): {len(seedable)}")
    print(f"phase2 fleet: {len(phase2_set)}")

    print("\n== ETH USDT ==")
    eth_bucket_rows, eth_from_block, eth_to_block = fetch_eth_addedblack()
    print(f"ETH AddedBlackList rows in bucket window: {len(eth_bucket_rows)}")

    print("\n== Tron USDT ==")
    tron_bucket_rows = fetch_tron_addedblack()
    print(f"Tron AddedBlackList rows in bucket window: {len(tron_bucket_rows)}")

    # Strict 29-30 window rows
    def in_window(r):
        return WIN_START <= r["block_ts_unix"] <= WIN_END

    eth_rows = [r for r in eth_bucket_rows if in_window(r)]
    tron_rows = [r for r in tron_bucket_rows if in_window(r)]
    print(f"strict-window ETH: {len(eth_rows)}  Tron: {len(tron_rows)}")

    # Pre-flight historical balance
    preflight = {"attempted": False, "ok": False, "note": None}
    if eth_rows:
        sample = eth_rows[0]
        print(f"\nPre-flight balanceOf @ block {sample['freeze_block']} for {sample['wallet']}")
        bal, err = eth_balance_at(sample["wallet"], hex(sample["freeze_block"]))
        preflight = {"attempted": True, "ok": bal is not None,
                     "sample_wallet": sample["wallet"],
                     "sample_block": sample["freeze_block"],
                     "sample_balance_raw": bal,
                     "error": err if bal is None else None}
        print(f"  result: ok={bal is not None} err={err}")

    # Historical balance per ETH row
    for r in eth_rows:
        if preflight.get("ok"):
            bal, err = eth_balance_at(r["wallet"], hex(r["freeze_block"]))
            if bal is None:
                r["balance_at_freeze_block"] = "unavailable"
                r["balance_error"] = err
            else:
                r["balance_at_freeze_block_raw"] = str(bal)
                r["balance_at_freeze_block_usdt"] = round(bal / 1e6, 6)
        else:
            r["balance_at_freeze_block"] = "unavailable"
            r["balance_error"] = "pre-flight failed; archive state not available"

    for r in tron_rows:
        r["balance_at_freeze_block"] = "unavailable"
        r["balance_error"] = "tron_historical_balance_not_queried_on_free_tier"

    # Match flags
    def tag_matches(r):
        w = r["wallet"]
        r["in_phase2_fleet"] = w in phase2_set
        r["in_census_seedable"] = w in seedable
        reason = []
        if not r["in_phase2_fleet"]:
            if r["is_sentinel"]:
                reason.append("sentinel_excluded_from_phase2")
            elif r["in_census_seedable"]:
                reason.append("in_census_but_not_phase2_scope")  # phase2 is USDT-only; seedable spans 7 contracts
            else:
                reason.append("post_cutoff_add")
        if not r["in_census_seedable"]:
            if r["is_sentinel"]:
                reason.append("sentinel_excluded_from_seedable")
            else:
                reason.append("post_cutoff_add_or_removed_before_census")
        r["match_notes"] = reason or None

    for r in eth_rows: tag_matches(r)
    for r in tron_rows: tag_matches(r)

    # Post-freeze wake scan (same contract)
    wake_hits = []
    if eth_rows:
        min_eth_freeze = min(r["freeze_block"] for r in eth_rows)
        print(f"\nScanning ETH post-events from block {min_eth_freeze} ..")
        eth_post, eth_head = fetch_eth_post_events(min_eth_freeze)
        wallets = {r["wallet"] for r in eth_rows}
        freeze_lookup = {r["wallet"]: r["freeze_block"] for r in eth_rows}
        for p in eth_post:
            if p["wallet"] in wallets and p["block"] > freeze_lookup[p["wallet"]]:
                wake_hits.append(p)
    if tron_rows:
        min_tron_ms = min(r["block_ts_ms"] for r in tron_rows)
        print(f"Scanning Tron post-events from ms {min_tron_ms} ..")
        tron_post = fetch_tron_post_events(min_tron_ms)
        wallets = {r["wallet"] for r in tron_rows}
        for p in tron_post:
            if p["wallet"] in wallets:
                wake_hits.append(p)
    print(f"post-freeze wake hits: {len(wake_hits)}")

    # 24h / 1h buckets around 29 Oct (ETH + Tron combined)
    all_bucket = [{"chain": r["chain"], "ts": r["block_ts_unix"]} for r in eth_bucket_rows + tron_bucket_rows]
    day_buckets = {}
    hour_buckets = {}
    for r in all_bucket:
        d = datetime.datetime.utcfromtimestamp(r["ts"]).strftime("%Y-%m-%d")
        h = datetime.datetime.utcfromtimestamp(r["ts"]).strftime("%Y-%m-%dT%H")
        day_buckets[d] = day_buckets.get(d, 0) + 1
        hour_buckets[h] = hour_buckets.get(h, 0) + 1

    out = {
        "generated_at_utc": datetime.datetime.utcnow().isoformat() + "Z",
        "purpose": "Binance-hack cross-check (Note 1). Every ETH+Tron USDT AddedBlackList in the 2026-10-29/30 UTC window, with historical balance, phase-2 / census-seedable join flags, post-freeze wake scan, and 24h/1h cluster buckets.",
        "disclaimer": "Tether's 29 Oct 2026 release does not list addresses. These rows are all USDT freezes in the window — a superset of any hack-related subset. We cannot say which rows are 'the hack wallets'.",
        "attribution": "Census data powered by Etherscan.",
        "window_utc": {"start": "2026-10-29T00:00:00Z", "end": "2026-10-30T23:59:59Z"},
        "bucket_window_utc": {"start": "2026-10-27T00:00:00Z", "end": "2026-11-01T23:59:59Z"},
        "sources": {
            "phase2_fleet": "docs/evidence/dormant-fleet-usdt-enriched.json (branch chain-watch/dormant-fleet-usdt)",
            "census": "docs/evidence/watchlist-30d-counts.json",
            "decoders": "docs/evidence/decode-fixtures.json",
        },
        "method": "Etherscan V2 logs/getLogs (ETH USDT, keccak topic AddedBlackList) over block range from block/getblocknobytime boundaries; TronGrid v1/contracts/{addr}/events with min/max_block_timestamp (Tron USDT). Dedup by (tx_hash, log_index) / (transaction_id, event_index). Historical balance via proxy/eth_call balanceOf(wallet) with tag=hex(freeze_block) after pre-flight check.",
        "sentinel_rule": "address[2:22] == \"0\"*20",
        "preflight_historical_balance": preflight,
        "tron_historical_balance_note": "Tron historical balance (at a past block) requires full-history archive state; the free TronGrid tier does not expose it reliably. All Tron rows carry balance_at_freeze_block=unavailable with that reason — per plan rule, this is a reported data gap, not a failure.",
        "counts": {
            "eth_window": len(eth_rows),
            "tron_window": len(tron_rows),
            "eth_bucket_window": len(eth_bucket_rows),
            "tron_bucket_window": len(tron_bucket_rows),
            "wake_hits": len(wake_hits),
        },
        "day_buckets_utc": dict(sorted(day_buckets.items())),
        "hour_buckets_utc": dict(sorted(hour_buckets.items())),
        "rows_eth": eth_rows,
        "rows_tron": tron_rows,
        "post_freeze_wake_hits": wake_hits,
        "budget_used": {
            "etherscan_v2_calls": ETHERSCAN_CALLS,
            "trongrid_calls": TRONGRID_CALLS,
        },
    }
    with open("docs/evidence/binance-xref-29oct2026.json", "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nwrote docs/evidence/binance-xref-29oct2026.json")
    print(f"ETH calls: {ETHERSCAN_CALLS}  Tron calls: {TRONGRID_CALLS}")

if __name__ == "__main__":
    main()
