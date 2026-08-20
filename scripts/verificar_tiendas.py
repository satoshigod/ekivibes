#!/usr/bin/env python3
"""Verifica lo que ve un cliente real: consulta la Store API con la publishable
key de cada tienda y confirma que cada producto aparece SOLO donde debe,
con precio, imagenes y categoria. Tambien comprueba que las fotos cargan."""
import json
import os
import urllib.error
import urllib.request

BASE = "https://ekivibes-production.up.railway.app"
NUEVOS = ["PAD-BACK-YM", "PAD-BACK-YMCV", "PAD-CHEST-ASC", "PAD-CHEST-HC",
          "CONN-HOLDER", "TOOL-SET"]


def req(method, path, headers=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"__error__": e.read().decode()[:400], "__status__": e.code}


def foto_ok(url):
    try:
        rr = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(rr, timeout=25) as resp:
            return resp.status == 200
    except Exception:
        return False


tok = req("POST", "/auth/user/emailpass", body={
    "email": os.environ["MEDUSA_EMAIL"], "password": os.environ["MEDUSA_PASSWORD"]})["token"]
adm = {"Authorization": "Bearer " + tok}

# publishable keys por canal
keys = {}
for k in req("GET", "/admin/api-keys?limit=50&type=publishable&fields=id,title,token,*sales_channels", adm).get("api_keys", []):
    for sc in (k.get("sales_channels") or []):
        keys.setdefault(sc["name"], k["token"])
print("Publishable keys encontradas por canal:")
for n, t in keys.items():
    print("  %-45s %s..." % (n, t[:24]))
print()

TIENDAS = [("TIENDA EKIVIBE COLOMBIA", "Ekivibes"), ("Hit-Air Colombia", "Hit-Air Colombia")]
ESPERADO = {
    "PAD-BACK-YM": {"Hit-Air Colombia"},
    "PAD-BACK-YMCV": {"Hit-Air Colombia"},
    "PAD-CHEST-ASC": {"Hit-Air Colombia"},
    "PAD-CHEST-HC": {"Hit-Air Colombia"},
    "CONN-HOLDER": {"Hit-Air Colombia"},
    "TOOL-SET": {"Hit-Air Colombia", "TIENDA EKIVIBE COLOMBIA"},
}

visto = {s: set() for s in NUEVOS}
for canal, etiqueta in TIENDAS:
    tk = keys.get(canal)
    if not tk:
        print("[!] sin publishable key para %s, se salta" % canal)
        continue
    print("=" * 66)
    print("TIENDA: %s" % etiqueta)
    print("=" * 66)
    d = req("GET", "/store/products?limit=100&fields=id,title,handle,thumbnail,*images,*variants.calculated_price,*categories",
            {"x-publishable-api-key": tk})
    if "__error__" in d:
        print("  ERROR: %s" % d)
        continue
    for p in d.get("products", []):
        skus = [v.get("sku") for v in p.get("variants", [])]
        nuevos_aqui = [s for s in skus if s in NUEVOS]
        if not nuevos_aqui:
            continue
        for s in nuevos_aqui:
            visto[s].add(canal)
        v = p["variants"][0]
        cp = (v.get("calculated_price") or {}).get("calculated_amount")
        imgs = [i["url"] for i in (p.get("images") or [])]
        rotas = [u for u in imgs if not foto_ok(u)]
        print("  %s" % p["title"])
        print("     sku=%s  precio=%s  cats=%s" % (
            nuevos_aqui, cp, [c["name"] for c in p.get("categories", [])]))
        print("     imagenes=%d  rotas=%d %s" % (len(imgs), len(rotas), rotas or ""))
    print()

print("=" * 66)
print("CONTROL DE FUGA ENTRE CANALES")
print("=" * 66)
fallas = 0
for s in NUEVOS:
    esp, real = ESPERADO[s], visto[s]
    if esp == real:
        print("  OK     %-16s visible en %s" % (s, sorted(real)))
    else:
        fallas += 1
        print("  ERROR  %-16s esperado=%s real=%s" % (s, sorted(esp), sorted(real)))

print("\nEquitacion no debe aparecer en Hit-Air ni viceversa.")
print("RESULTADO: %s" % ("TODO CORRECTO" if not fallas else "%d PROBLEMAS" % fallas))
