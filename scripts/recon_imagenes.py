#!/usr/bin/env python3
"""Lista TODAS las imagenes (thumbnail + galeria) de cada producto y marca las rotas."""
import json, os, urllib.request, urllib.error

BASE = "https://ekivibes-production.up.railway.app"


def req(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"__error__": e.read().decode()[:400], "__status__": e.code}


def clasificar(u):
    if not u:
        return "SIN-IMAGEN"
    if "localhost" in u:
        return "ROTA (localhost)"
    if "hit-air.com" in u:
        return "HOTLINK (hit-air.com)"
    if "railway.app" in u:
        return "ok autohospedada"
    return "otra"


tok = req("POST", "/auth/user/emailpass", body={
    "email": os.environ["MEDUSA_EMAIL"], "password": os.environ["MEDUSA_PASSWORD"]})["token"]

prods = req("GET", "/admin/products?limit=200&fields=id,title,handle,thumbnail,*images,*variants", tok)["products"]
for p in prods:
    print("=" * 70)
    print("%s  [%s]" % (p["title"], p["id"]))
    print("  handle: %s" % p.get("handle"))
    print("  skus: %s" % [v.get("sku") for v in p.get("variants", [])])
    print("  THUMBNAIL: %-20s %s" % (clasificar(p.get("thumbnail")), p.get("thumbnail")))
    imgs = p.get("images") or []
    if not imgs:
        print("  GALERIA: (vacia)")
    for im in imgs:
        print("    img %-22s id=%s  %s" % (clasificar(im.get("url")), im.get("id"), im.get("url")))
