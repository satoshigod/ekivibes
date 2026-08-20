#!/usr/bin/env python3
"""
Dos correcciones en el canal Hit-Air Colombia:

1. Homogeneiza a extension media (~80-90 palabras) la descripcion de MLV2-RC,
   HDS-MS y MX-9, que habian quedado en 14-20 palabras. El EU7 ya estaba en 89
   y no se toca. Sus secciones inferiores no se modifican.

2. Agrega la categoria "Accesorios Moto" a los dos cartuchos de CO2. El seed
   original solo les asigno "Repuestos y Accesorios Hit-Air" (la categoria
   ecuestre), asi que nunca aparecieron en la categoria de moto pese a estar
   en el canal Hit-Air Colombia. Se CONSERVA la categoria existente para que
   sigan visibles en Ekivibes.
"""
import json
import os
import urllib.error
import urllib.request

BASE = "https://ekivibes-production.up.railway.app"
DRY_RUN = os.environ.get("DRY_RUN", "") == "1"

DESCRIPCIONES = {
    "hitair-mlv2-rc-vest-black":
        "Chaleco airbag para motociclismo que se pone encima de la ropa que ya usas, sin obligarte a "
        "cambiar de chaqueta. Al separarte de la moto, el cable en espiral libera la llave y el airbag "
        "se infla en una décima de segundo, cubriendo cuello, columna, tórax y coxis antes del impacto "
        "contra el suelo. La activación es totalmente mecánica: no lleva electrónica, sensores ni "
        "baterías que cargar. Después de usarlo se rearma cambiando el cartucho de CO2 y vuelve a estar "
        "operativo. Acabado en negro con elementos reflectivos.",

    "hitair-hds-ms-jacket-black":
        "Chaqueta urbana con el sistema airbag Hit-Air integrado, pensada para quien quiere protección "
        "sin que se note que la lleva. Trae capucha desmontable y protectores CE de serie, y por dentro "
        "aloja el airbag que se despliega sobre cuello, espalda y tórax cuando el cable en espiral hace "
        "tensión en una caída. Todo el mecanismo es manual, sin electrónica ni baterías. La caja de "
        "llave queda accesible para rearmar el sistema tras cada activación cambiando el cartucho de "
        "CO2. Color negro con detalles reflectivos.",

    "hitair-mx9-jacket-black":
        "Chaqueta en tejido tipo malla con airbag integrado, orientada a enduro y adventure, donde la "
        "ventilación pesa tanto como la protección. Incluye protectores CE HEXA en hombros y codos más "
        "protector de espalda, y sobre eso el airbag Hit-Air, que cubre cuello, columna y tórax al "
        "inflarse. La activación es mecánica mediante el cable en espiral anclado a la moto: sin "
        "sensores ni baterías, funciona igual en el primer kilómetro que en el último. Se rearma "
        "reemplazando el cartucho de CO2. Color negro con reflectivos.",
}

# handle -> categorias que deben quedar (se suman a las existentes)
AGREGAR_CATEGORIAS = {
    "cartucho-de-co2-hit-air-50cc": ["Accesorios Moto"],
    "cartucho-de-co2-hit-air-60cc": ["Accesorios Moto"],
}


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

cats = {c["name"]: c["id"] for c in req(
    "GET", "/admin/product-categories?limit=100", tok)["product_categories"]}
prods = {p["handle"]: p for p in req(
    "GET", "/admin/products?limit=200&fields=id,title,handle,description,*categories", tok)["products"]}

print("--- 1. Descripciones homogeneizadas ---")
for handle, texto in DESCRIPCIONES.items():
    p = prods.get(handle)
    if not p:
        print("[!] no existe %s" % handle)
        continue
    antes = len((p.get("description") or "").split())
    if DRY_RUN:
        print("[DRY] %-32s %d -> %d palabras" % (handle, antes, len(texto.split())))
        continue
    res = req("POST", "/admin/products/%s" % p["id"], tok, {"description": texto})
    print(("[FALLO] %s: %s" % (handle, res)) if "__error__" in res
          else "[OK] %-32s %d -> %d palabras" % (handle, antes, len(texto.split())))

print("\n--- 2. Categoria de los cartuchos de CO2 ---")
for handle, nuevas in AGREGAR_CATEGORIAS.items():
    p = prods.get(handle)
    if not p:
        print("[!] no existe %s" % handle)
        continue
    actuales = [c["name"] for c in p.get("categories") or []]
    final = sorted(set(actuales) | set(nuevas))
    faltan = [c for c in final if c not in cats]
    if faltan:
        print("[!] categorias inexistentes %s, se salta %s" % (faltan, handle))
        continue
    if set(actuales) == set(final):
        print("[OK-YA] %s ya tiene %s" % (handle, actuales))
        continue
    if DRY_RUN:
        print("[DRY] %-32s %s -> %s" % (handle, actuales, final))
        continue
    res = req("POST", "/admin/products/%s" % p["id"], tok,
              {"categories": [{"id": cats[c]} for c in final]})
    print(("[FALLO] %s: %s" % (handle, res)) if "__error__" in res
          else "[OK] %-32s %s -> %s" % (handle, actuales, final))

print("\n=== ESTADO FINAL DEL CANAL HIT-AIR COLOMBIA ===")
for p in req("GET", "/admin/products?limit=200&fields=id,title,handle,description,*categories,*sales_channels", tok)["products"]:
    if "Hit-Air Colombia" not in [c["name"] for c in p.get("sales_channels") or []]:
        continue
    print("  %-45s %3d palabras  %s" % (
        p["handle"][:45], len((p.get("description") or "").split()),
        [c["name"] for c in p.get("categories") or []]))
