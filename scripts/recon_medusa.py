#!/usr/bin/env python3
"""Dump del estado actual de Medusa: canales, categorias, colecciones, productos."""
import json, os, urllib.request, urllib.error

BASE = "https://ekivibes-production.up.railway.app"


def req(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return {"__error__": raw[:500], "__status__": e.code}


def login():
    d = req("POST", "/auth/user/emailpass", body={
        "email": os.environ["MEDUSA_EMAIL"],
        "password": os.environ["MEDUSA_PASSWORD"],
    })
    t = d.get("token")
    if not t:
        raise SystemExit("Login fallido: %s" % d)
    return t


def main():
    tok = login()
    print("=== LOGIN OK ===\n")

    print("=== SALES CHANNELS ===")
    for c in req("GET", "/admin/sales-channels?limit=50", tok).get("sales_channels", []):
        print(f"  {c['id']}  |  {c['name']}")

    print("\n=== PRODUCT CATEGORIES ===")
    cats = req("GET", "/admin/product-categories?limit=100&fields=id,name,handle,parent_category_id,rank,is_active,is_internal", tok).get("product_categories", [])
    for c in cats:
        print(f"  {c['id']}  |  handle={c.get('handle')}  |  name={c['name']}  |  parent={c.get('parent_category_id')}  |  rank={c.get('rank')}  active={c.get('is_active')}")
    if not cats:
        print("  (ninguna)")

    print("\n=== COLLECTIONS ===")
    cols = req("GET", "/admin/collections?limit=100", tok).get("collections", [])
    for c in cols:
        print(f"  {c['id']}  |  handle={c.get('handle')}  |  title={c['title']}")
    if not cols:
        print("  (ninguna)")

    print("\n=== STOCK LOCATIONS ===")
    for s in req("GET", "/admin/stock-locations?limit=20", tok).get("stock_locations", []):
        print(f"  {s['id']}  |  {s['name']}")

    print("\n=== SHIPPING PROFILES ===")
    for s in req("GET", "/admin/shipping-profiles?limit=20", tok).get("shipping_profiles", []):
        print(f"  {s['id']}  |  {s['name']}  |  type={s.get('type')}")

    print("\n=== PRODUCTS ===")
    prods = req("GET", "/admin/products?limit=100&fields=id,title,handle,status,thumbnail,*variants,*categories,*collection,*sales_channels", tok).get("products", [])
    print(f"total: {len(prods)}\n")
    for p in prods:
        chans = ", ".join(c["name"] for c in (p.get("sales_channels") or []))
        cats_ = ", ".join(c["name"] for c in (p.get("categories") or []))
        col = (p.get("collection") or {}).get("title")
        print(f"- {p['title']}")
        print(f"    id={p['id']} handle={p.get('handle')} status={p.get('status')}")
        print(f"    canales=[{chans}]  categorias=[{cats_}]  coleccion={col}")
        for v in (p.get("variants") or []):
            print(f"    variante: sku={v.get('sku')} title={v.get('title')}")
        print(f"    thumbnail={p.get('thumbnail')}")


main()
