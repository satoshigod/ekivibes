#!/usr/bin/env python3
"""
Recrea las variantes M y L de MLV3-H Adulto.
Tenian un link huerfano a un inventory item inexistente (inventory_item_id vacio),
lo que impedia darles stock y rompia 'agregar al carrito'.
"""
import json
import os
import urllib.request
import urllib.error

BASE = "https://ekivibes-production.up.railway.app"
LOCATION_ID = "sloc_01KZPAFBNMW4WBK5VRZQA5G1C2"
REGION_ID = "reg_01KZPA5VQ4345MB8FP453A5EED"
MLV_ID = "prod_01KZPGKJGYE9A7MCANTS6V0Z97"
PRICE = 2850000
QTY = 100

TARGETS = ["M", "L"]


def req(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return {"__error__": json.loads(raw), "__status__": e.code}
        except Exception:
            return {"__error__": raw[:200], "__status__": e.code}


def login():
    d = req("POST", "/auth/user/emailpass",
            body={"email": os.environ["MEDUSA_EMAIL"],
                  "password": os.environ["MEDUSA_PASSWORD"]})
    t = d.get("token")
    if not t:
        raise SystemExit("Login fallido: %s" % d)
    return t


def main():
    token = login()
    print("Login OK")

    prod = req("GET", "/admin/products/%s" % MLV_ID, token).get("product", {})
    print("Variantes actuales: %s" % [v["title"] for v in prod.get("variants", [])])

    # 1. Borrar las variantes problematicas
    for v in prod.get("variants", []):
        if v["title"] in TARGETS:
            r = req("DELETE", "/admin/products/%s/variants/%s" % (MLV_ID, v["id"]), token)
            err = r.get("__error__")
            print("Borrando %s (%s): %s" % (v["title"], v["id"], "ERROR %s" % err if err else "OK"))

    # 2. Recrear limpias
    for talla in TARGETS:
        body = {
            "title": talla,
            "sku": "MLV-ADU-%s-clean" % talla,
            "manage_inventory": True,
            "options": {"Talla": talla},
            "prices": [{"amount": PRICE, "currency_code": "cop", "region_id": REGION_ID}],
        }
        r = req("POST", "/admin/products/%s/variants" % MLV_ID, token, body)
        if "__error__" in r:
            print("Creando %s: ERROR %s" % (talla, r["__error__"]))
            continue
        vs = [x["id"] for x in r.get("product", {}).get("variants", [])
              if x.get("sku") == body["sku"]]
        vid = vs[0] if vs else None
        print("Creada %s -> %s" % (talla, vid))

        if not vid:
            continue

        # 3. Inventory item + stock
        inv = req("POST", "/admin/inventory-items", token,
                  {"sku": "inv-mlv-%s-clean" % talla.lower(), "requires_shipping": True})
        iid = inv.get("inventory_item", {}).get("id")
        if not iid:
            print("   ERROR inventory item: %s" % inv.get("__error__"))
            continue
        req("POST", "/admin/products/%s/variants/%s/inventory-items" % (MLV_ID, vid),
            token, {"inventory_item_id": iid, "required_quantity": 1})
        req("POST", "/admin/inventory-items/%s/location-levels" % iid, token,
            {"location_id": LOCATION_ID, "stocked_quantity": QTY})
        print("   inventory %s con %d unidades" % (iid, QTY))

    # 4. Verificacion
    print("\n=== VERIFICACION MLV3-H ADULTO ===")
    fields = ("?fields=id,title,*variants,*variants.inventory_items,"
              "*variants.inventory_items.inventory,"
              "*variants.inventory_items.inventory.location_levels")
    full = req("GET", "/admin/products/%s%s" % (MLV_ID, fields), token).get("product", {})
    for v in full.get("variants", []):
        links = v.get("inventory_items", [])
        estados = []
        for link in links:
            iid = link.get("inventory_item_id")
            if not iid:
                estados.append("HUERFANO")
                continue
            levels = (link.get("inventory") or {}).get("location_levels") or []
            m = [l for l in levels if l.get("location_id") == LOCATION_ID]
            estados.append(m[0].get("stocked_quantity") if m else "SIN-STOCK")
        ok = bool(estados) and all(e not in ("SIN-STOCK", "HUERFANO") for e in estados)
        precio = [p["amount"] for p in v.get("prices", [])
                  if p.get("currency_code") == "cop"]
        print("   %s items=%d stock=%s precio=%s %s"
              % (v.get("title"), len(links), estados, precio, "OK" if ok else "REVISAR"))


if __name__ == "__main__":
    main()
