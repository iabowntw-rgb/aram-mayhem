"""抓取 OP.GG「隨機單中：大混戰」各英雄的強化符文、裝備、技能點法統計，輸出成網頁用的 JSON。

只用 Python 標準函式庫。用法：
    python scraper/scrape.py                 # 抓全部英雄，輸出到 site/data
    python scraper/scrape.py --only kaisa,teemo
    python scraper/scrape.py --out site/data --delay 0.8
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

BASE = "https://op.gg/zh-tw/lol/modes/aram-mayhem"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")


# ---------------------------------------------------------------- 下載與解析

def fetch(url, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-TW"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"下載失敗 {url}: {last}")


def rsc_payload(html):
    """把 Next.js 頁面中 self.__next_f.push(...) 的片段串成完整的 RSC 文字。"""
    out = []
    for chunk in re.findall(r"self\.__next_f\.push\((\[.*?\])\)</script>", html, re.S):
        try:
            arr = json.loads(chunk)
        except ValueError:
            continue
        if len(arr) > 1 and isinstance(arr[1], str):
            out.append(arr[1])
    return "".join(out)


def rsc_nodes(html):
    """回傳每一行 RSC 資料解析後的 JSON（無法解析的行略過）。"""
    nodes = []
    for part in re.split(r"\n(?=[0-9a-f]+:)", rsc_payload(html)):
        _, _, body = part.partition(":")
        try:
            nodes.append(json.loads(body))
        except ValueError:
            pass
    return nodes


def walk(node):
    """深度優先走訪所有 dict。"""
    stack = [node]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            yield n
            stack.extend(n.values())
        elif isinstance(n, list):
            stack.extend(n)


def first_title(node):
    """找出這段 RSC 節點裡第一個短字串標題（例如「鞋子」「裝備」）。"""
    for d in walk(node):
        c = d.get("children")
        if isinstance(c, str) and 0 < len(c) <= 12:
            return c
    return None


def num(v, default=0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def r1(v):
    return round(num(v), 2)


# ---------------------------------------------------------------- 各分頁

def parse_champion_list(html):
    champs = {}
    for node in rsc_nodes(html):
        for d in walk(node):
            if {"key", "name", "image_url", "champion_id", "tier", "rank"} <= d.keys():
                champs.setdefault(d["key"], {
                    "key": d["key"],
                    "name": d["name"],
                    "id": d["champion_id"],
                    "image": d["image_url"],
                    "tier": d["tier"],
                    "rank": d["rank"],
                })
    patch = None
    m = re.search(r'"patch(?:_version)?":"(\d+\.\d+)"', rsc_payload(html))
    if m:
        patch = m.group(1)
    return sorted(champs.values(), key=lambda c: c["rank"]), patch


def parse_items(html, item_dict):
    res = {"core": [], "boots": [], "starters": [], "items": []}
    sections = {"核心裝備": "core", "鞋子": "boots", "起始裝備": "starters", "裝備": "items"}

    def remember(meta):
        if isinstance(meta, dict) and "id" in meta:
            item_dict.setdefault(str(meta["id"]), {"name": meta.get("name"), "image": meta.get("image_url")})

    for node in rsc_nodes(html):
        title = first_title(node)
        target = sections.get(title)
        if not target:
            continue
        for d in walk(node):
            data = d.get("data")
            if not (isinstance(data, list) and data and isinstance(data[0], dict) and "ids" in data[0]):
                continue
            rows = []
            for e in data:
                for meta in e.get("metaBuildItems") or []:
                    remember(meta)
                remember(e.get("metaItem"))
                for pair in e.get("metaStarterItems") or []:
                    if isinstance(pair, list) and pair:
                        remember(pair[0])
                rows.append({
                    "ids": e["ids"],
                    "play": int(num(e.get("play"))),
                    "pick": r1(e.get("pick_rate")),
                    "win": r1(e.get("win_rate")),
                })
            if target in ("boots", "items"):
                rows = [{"id": r["ids"][0], **{k: r[k] for k in ("play", "pick", "win")}} for r in rows]
            res[target] = rows
            break
    res["core"] = res["core"][:3]
    res["starters"] = res["starters"][:5]
    return res


def parse_augments(html, aug_dict):
    for node in rsc_nodes(html):
        for d in walk(node):
            data = d.get("data")
            if isinstance(data, list) and data and isinstance(data[0], dict) and "performance" in data[0]:
                rows = []
                for e in data:
                    if "name" not in e:  # OP.GG 也沒有資料的未知符文
                        continue
                    aug_dict.setdefault(str(e["id"]), {
                        "name": e["name"],
                        "icon": e.get("largeIcon") or e.get("smallIcon"),
                        "rarity": e.get("rarity"),
                        "desc": e.get("desc", ""),
                        "tooltip": e.get("tooltip", ""),
                    })
                    rows.append({
                        "id": e["id"],
                        "tier": e.get("tier"),
                        "perf": r1(e.get("performance")),
                        "pop": r1(e.get("popular")),
                    })
                return rows
    return []


def parse_skills(html):
    for node in rsc_nodes(html):
        for d in walk(node):
            sm = d.get("skill_masteries")
            if not isinstance(sm, list):
                continue
            spells = {}
            masteries = []
            for m in sm:
                for s in m.get("skills") or []:
                    if isinstance(s, dict) and "key" in s:
                        spells.setdefault(s["key"], {"name": s.get("name"), "image": s.get("image_url")})
                builds = []
                for b in (m.get("builds") or [])[:3]:
                    for s in b.get("skills") or []:
                        if isinstance(s, dict) and "key" in s:
                            spells.setdefault(s["key"], {"name": s.get("name"), "image": s.get("image_url")})
                    builds.append({
                        "order": "".join(b.get("order") or []),
                        "play": int(num(b.get("play"))),
                        "pick": r1(num(b.get("pick_rate")) * 100),
                        "win": r1(num(b.get("win_rate")) * 100),
                    })
                masteries.append({
                    "order": "".join(m.get("ids") or []),
                    "play": int(num(m.get("play"))),
                    "pick": r1(num(m.get("pick_rate")) * 100),
                    "win": r1(num(m.get("win_rate")) * 100),
                    "builds": builds,
                })
            return {"masteries": masteries, "spells": spells}
    return {"masteries": [], "spells": {}}


# ---------------------------------------------------------------- 主流程

def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "site", "data"))
    ap.add_argument("--delay", type=float, default=0.8, help="每次請求間隔秒數")
    ap.add_argument("--only", default="", help="只抓指定英雄 key，逗號分隔")
    args = ap.parse_args()
    out = os.path.abspath(args.out)

    champs, patch = parse_champion_list(fetch(BASE))
    if not champs:
        sys.exit("找不到英雄列表，OP.GG 可能改版了")
    targets = [c for c in champs if not args.only or c["key"] in args.only.split(",")]
    print(f"版本 {patch}，共 {len(champs)} 隻英雄，本次抓 {len(targets)} 隻", flush=True)

    # 增量合併：保留既有字典，避免 --only 時把其他資料洗掉
    def load(name, default):
        try:
            with open(os.path.join(out, name), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return default

    items = load("items.json", {})
    augs = load("augments.json", {})
    failed = []

    for i, c in enumerate(targets, 1):
        key = c["key"]
        try:
            it = parse_items(fetch(f"{BASE}/{key}/items"), items)
            time.sleep(args.delay)
            au = parse_augments(fetch(f"{BASE}/{key}/augments"), augs)
            time.sleep(args.delay)
            sk = parse_skills(fetch(f"{BASE}/{key}/skills"))
            time.sleep(args.delay)
            # 由「場數 ÷ 選用率」推算這隻英雄的總場數
            top = max(it["items"], key=lambda r: r["play"], default=None)
            games = round(top["play"] * 100 / top["pick"]) if top and top["pick"] else None
            write_json(os.path.join(out, "champions", f"{key}.json"), {
                **c, **it, "augments": au, "skills": sk, "sample": games,
            })
            c["sample"] = games
            print(f"[{i}/{len(targets)}] {c['name']} ({key}) 符文 {len(au)}、裝備 {len(it['items'])}", flush=True)
        except Exception as e:  # noqa: BLE001
            failed.append(key)
            print(f"[{i}/{len(targets)}] {key} 失敗：{e}", flush=True)

    write_json(os.path.join(out, "items.json"), items)
    write_json(os.path.join(out, "augments.json"), augs)
    old = {c["key"]: c for c in load("index.json", {}).get("champions", [])}
    for c in champs:
        if "sample" not in c and c["key"] in old:
            c["sample"] = old[c["key"]].get("sample")
    write_json(os.path.join(out, "index.json"), {
        "patch": patch,
        "updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "champions": champs,
    })

    print(f"完成，失敗 {len(failed)} 隻：{failed}")
    if len(failed) > max(5, len(targets) * 0.2):
        sys.exit(1)


if __name__ == "__main__":
    main()
