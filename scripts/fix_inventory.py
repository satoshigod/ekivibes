#!/usr/bin/env python3
"""
Limpia el inventario de todos los productos:
- Cada variante queda con UN SOLO inventory item enlazado
- Ese item tiene 100 unidades en BODEGA MEDELLIN
- Los duplicados se desenlazan (esto es lo que rompia el carrito:
  Medusa exige que TODOS los items enlazados tengan stock)
"""
import json
import os
import urllib.request
import urllib.error

BASE = "https://ekivibes-production.up.railway.app"
LOCATION_ID = "sloc_01KZPAFBNMW4WBK5VRZQA5G1C2"
QTY = 100


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
            return {"__error__": raw, "__status__": e.code}


def login():
    email = os.environ["MEDUSA_EMAIL"]
    password = os.environ["MEDUSA_PASSWORD"]
    d = req("POST", "/auth/user/emailpass", body={"email": email, "password": password})
    token = d.get("token")
    if not token:
        raise SystemExit("Login fallido: %s" % d)
    return token


def main():
    token = login()
    print("Login OK")

    prods = req("GET", "/admin/products?limit=50", token).get("products", [])
    print("Productos: %d\n" % len(prods))

    total_fixed = 0
    total_unlinked = 0

    for p in prods:
        pid = p["id"]
        fields = (
            "?fields=id,title,*variants,*variants.inventory_items,"
            "*variants.inventory_items.inventory,"
            "*variants.inventory_items.inventory.location_levels"
        )
        full = req("GET", "/admin/products/%s%s" % (pid, fields), token).get("product", {})
        print("PRODUCTO: %s" % full.get("title"))

        for v in full.get("variants", []):
            vid = v["id"]
            title = v.get("title")
            links = v.get("inventory_items", [])

            if not links:
                # Sin inventory item: crear uno
                sku = "auto-%s" % vid[-10:]
                inv = req("POST", "/admin/inventory-items", token,
                          {"sku": sku, "requires_shipping": True})
                iid = inv.get("inventory_item", {}).get("id")
                if not iid:
                    print("   %s: ERROR creando item -> %s" % (title, inv.get("__error__")))
                    continue
                req("POST", "/admin/products/%s/variants/%s/inventory-items" % (pid, vid),
                    token, {"inventory_item_id": iid, "required_quantity": 1})
                req("POST", "/admin/inventory-items/%s/location-levels" % iid, token,
                    {"location_id": LOCATION_ID, "stocked_quantity": QTY})
                print("   %s: creado %s con %d" % (title, iid, QTY))
                total_fixed += 1
                continue

            # Estrategia: dar stock a TODOS los items enlazados.
            # Medusa exige que cada item enlazado tenga stock; el DELETE de
            # desenlace no es fiable, asi que aseguramos stock en todos.
            for link in links:
                iid = link.get("inventory_item_id")
                if not iid:
                    print("      ! link huerfano (sin inventory_item_id), omitido")
                    continue
                inv = link.get("inventory") or {}
                levels = inv.get("location_levels") or []
                has_level = any(l.get("location_id") == LOCATION_ID for l in levels)
                if has_level:
                    r = req("POST",
                            "/admin/inventory-items/%s/location-levels/%s" % (iid, LOCATION_ID),
                            token, {"stocked_quantity": QTY})
                else:
                    r = req("POST", "/admin/inventory-items/%s/location-levels" % iid, token,
                            {"location_id": LOCATION_ID, "stocked_quantity": QTY})
                if "__error__" in r:
                    print("      ! %s -> %s" % (iid, r.get("__error__")))
                else:
                    total_unlinked += 1

            print("   %s: %d items, todos con stock %d" % (title, len(links), QTY))
            total_fixed += 1

        print("")

    print("=== RESUMEN ===")
    print("Variantes procesadas: %d" % total_fixed)
    print("Niveles de stock aplicados: %d" % total_unlinked)

    # Verificacion final
    print("\n=== VERIFICACION ===")
    for p in prods:
        fields = (
            "?fields=id,title,*variants,*variants.prices,*variants.inventory_items,"
            "*variants.inventory_items.inventory,"
            "*variants.inventory_items.inventory.location_levels"
        )
        full = req("GET", "/admin/products/%s%s" % (p["id"], fields), token).get("product", {})
        print(full.get("title"))
        for v in full.get("variants", []):
            links = v.get("inventory_items", [])
            estados = []
            for link in links:
                inv = link.get("inventory") or {}
                levels = inv.get("location_levels") or []
                match = [l for l in levels if l.get("location_id") == LOCATION_ID]
                estados.append(match[0].get("stocked_quantity") if match else "SIN-STOCK")
            ok = bool(estados) and all(e != "SIN-STOCK" for e in estados)
            precio = [pr["amount"] for pr in (v.get("prices") or [])
                      if pr.get("currency_code") == "cop"]
            print("   %s items=%d stock=%s precio=%s %s"
                  % (v.get("title"), len(links), estados, precio,
                     "OK" if ok else "REVISAR"))


if __name__ == "__main__":
    main()
