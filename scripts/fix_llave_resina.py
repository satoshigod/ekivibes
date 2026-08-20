#!/usr/bin/env python3
"""
Llave de Resina Tipo B (SKU KEY-RESIN): es un producto INFANTIL y asi debe
quedar identificado, con dos escrituras distintas segun donde se lea:

  - Frontend (product.title y description): espanol correcto, "Ninos" con enye.
  - Backend (inventory_item.title): ASCII, "NINOS" sin enye, siguiendo la misma
    convencion que ya usan los SKU del catalogo.

Hoy esta al reves: el titulo de producto dice "Ninos" sin enye y el item de
inventario ni siquiera menciona que es infantil.

Solo toca este producto. Al final imprime un informe de los demas productos
infantiles para verificar que no haya inconsistencias, sin modificarlos.
"""
import json
import os
import urllib.error
import urllib.request

BASE = "https://ekivibes-production.up.railway.app"
DRY_RUN = os.environ.get("DRY_RUN", "") == "1"

HANDLE = "llave-de-resina-tipo-b-hit-air"
SKU = "KEY-RESIN"

TITULO_FRONT = "Llave de Resina Tipo B Hit-Air Ni\u00f1os"
TITULO_INVENTARIO = "Llave de Resina Tipo B Hit-Air NINOS"


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

# ---- 1. Producto (frontend) ----
prods = req("GET", "/admin/products?limit=200&fields=id,title,handle,description", tok)["products"]
p = next((x for x in prods if x["handle"] == HANDLE), None)
if not p:
    raise SystemExit("No se encontro el producto %s" % HANDLE)

desc = p.get("description") or ""
# "(ninos)" dentro del texto tambien es cara visible: va con enye.
desc_nueva = desc.replace("(ninos)", "(ni\u00f1os)").replace("(Ninos)", "(Ni\u00f1os)")

print("--- FRONTEND (producto) ---")
print("  titulo actual : %r" % p["title"])
print("  titulo nuevo  : %r" % TITULO_FRONT)
print("  descripcion   : %s" % ("se corrige 'ninos' -> 'ninos' con enye"
                                if desc != desc_nueva else "sin cambios"))

if not DRY_RUN:
    res = req("POST", "/admin/products/%s" % p["id"], tok,
              {"title": TITULO_FRONT, "description": desc_nueva})
    print("  -> %s" % ("FALLO: %s" % res if "__error__" in res else "actualizado"))

# ---- 2. Inventario (backend) ----
items = req("GET", "/admin/inventory-items?limit=200&fields=id,sku,title", tok)["inventory_items"]
it = next((x for x in items if x.get("sku") == SKU), None)
print("\n--- BACKEND (inventory item) ---")
if not it:
    print("  [!] no se encontro InventoryItem con sku %s" % SKU)
else:
    print("  titulo actual : %r" % it.get("title"))
    print("  titulo nuevo  : %r" % TITULO_INVENTARIO)
    if not DRY_RUN:
        res = req("POST", "/admin/inventory-items/%s" % it["id"], tok,
                  {"title": TITULO_INVENTARIO})
        print("  -> %s" % ("FALLO: %s" % res if "__error__" in res else "actualizado"))

# ---- 3. Informe del resto de productos infantiles (NO se modifican) ----
print("\n=== INFORME: otros productos infantiles (solo lectura) ===")
prods2 = req("GET", "/admin/products?limit=200&fields=id,title,handle,*variants", tok)["products"]
items2 = {x.get("sku"): x for x in req(
    "GET", "/admin/inventory-items?limit=200&fields=id,sku,title", tok)["inventory_items"]}
for pr in prods2:
    t = pr["title"]
    if "ni\u00f1o" not in t.lower() and "nino" not in t.lower() and "NIN" not in "".join(
            (v.get("sku") or "") for v in pr.get("variants") or []):
        continue
    print("  producto : %r" % t)
    print("     enye en el titulo: %s" % ("si" if "\u00f1" in t else "NO"))
    for v in pr.get("variants") or []:
        sku = v.get("sku")
        inv = items2.get(sku)
        print("     sku=%-14s inventario=%r  ascii=%s" % (
            sku, (inv or {}).get("title"),
            "si" if all(ord(c) < 128 for c in ((inv or {}).get("title") or "")) else "NO"))
