#!/usr/bin/env python3
"""
Normaliza el titulo de los InventoryItem de los 6 productos creados el
2026-08-20, al patron "<Producto> - <Variante>".

Los productos creados via Admin API heredan como titulo del InventoryItem solo
el titulo de la variante ("Estandar"), lo que deja el listado de inventario del
Admin ilegible. Se emparejan por SKU, que es unico.

Solo escribe cuando el titulo actual difiere del esperado. No toca cantidades,
ubicaciones, precios ni ningun otro campo.
"""
import json
import os
import urllib.error
import urllib.request

BASE = "https://ekivibes-production.up.railway.app"
DRY_RUN = os.environ.get("DRY_RUN", "") == "1"

# Alcance CERRADO: solo estos 6. El resto del inventario ya tiene el nombre
# correcto y no se toca.
SOLO = {"PAD-BACK-YM", "PAD-BACK-YMCV", "PAD-CHEST-ASC",
        "PAD-CHEST-HC", "CONN-HOLDER", "TOOL-SET"}


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


tok = req("POST", "/auth/user/emailpass", body={
    "email": os.environ["MEDUSA_EMAIL"], "password": os.environ["MEDUSA_PASSWORD"]})["token"]
print("Login OK\n")

# sku -> titulo esperado, construido desde el catalogo
esperado = {}
for p in req("GET", "/admin/products?limit=200&fields=id,title,*variants", tok)["products"]:
    for v in p.get("variants", []):
        if v.get("sku"):
            esperado[v["sku"]] = "%s - %s" % (p["title"], v.get("title") or "Estandar")

todos = req("GET", "/admin/inventory-items?limit=200&fields=id,sku,title", tok)["inventory_items"]
items = [i for i in todos if i.get("sku") in SOLO]
print("InventoryItems en total: %d   |   dentro del alcance: %d\n" % (len(todos), len(items)))
if len(items) != len(SOLO):
    faltan = SOLO - {i.get("sku") for i in items}
    print("[!] no se encontraron: %s\n" % faltan)

cambiados = ok = huerfanos = 0
for it in items:
    sku = it.get("sku")
    exp = esperado.get(sku)
    if not exp:
        huerfanos += 1
        print("[HUERFANO] sku=%s title=%r  (sin variante asociada, revisar)" % (sku, it.get("title")))
        continue
    if it.get("title") == exp:
        ok += 1
        continue
    if DRY_RUN:
        print("[DRY] %-16s %r  ->  %r" % (sku, it.get("title"), exp))
        cambiados += 1
        continue
    res = req("POST", "/admin/inventory-items/%s" % it["id"], tok, {"title": exp})
    if "__error__" in res:
        print("[FALLO] %s: %s" % (sku, res))
    else:
        print("[OK] %-16s %r  ->  %r" % (sku, it.get("title"), exp))
        cambiados += 1

print("\nya correctos=%d  cambiados=%d  huerfanos=%d" % (ok, cambiados, huerfanos))

print("\n=== ESTADO FINAL (solo los 6) ===")
for it in sorted(req("GET", "/admin/inventory-items?limit=200&fields=id,sku,title", tok)["inventory_items"],
                 key=lambda x: x.get("sku") or ""):
    if it.get("sku") in SOLO:
        print("  %-16s %s" % (it.get("sku"), it.get("title")))
