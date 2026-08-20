#!/usr/bin/env python3
"""
Reemplaza las imagenes rotas (http://localhost:9000/...) y los hotlinks a
hit-air.com por fotos oficiales auto-hospedadas en los storefronts.

Cada producto queda con thumbnail + galeria completa. No toca precios,
variantes, inventario, canales ni categorias: solo 'thumbnail' e 'images'.

Idempotente: si un producto ya apunta a las URLs correctas, no hace nada.
"""
import json
import os
import urllib.error
import urllib.request

BASE = "https://ekivibes-production.up.railway.app"
EKV = "https://ekivibes-storefront-production.up.railway.app/product-details"
MOTO = "https://hitair-colombia-storefront-production.up.railway.app/product-details"

DRY_RUN = os.environ.get("DRY_RUN", "") == "1"

# handle del producto -> (base_url, [nombres de archivo en orden; el 1o es thumbnail])
FIX = {
    "chaleco-airbag-vh-juvenil-adulto": (EKV, [
        "vh-adulto-main.jpg", "vh-adulto-02.jpg", "vh-adulto-03.jpg", "vh-adulto-04.jpg",
        "vh-adulto-05.jpg", "vh-adulto-06.jpg", "vh-adulto-07.jpg"]),
    "chaleco-airbag-vh-ninos": (EKV, [
        "vh-ninos-main.jpg", "vh-ninos-02.jpg", "vh-ninos-03.jpg", "vh-ninos-04.jpg",
        "vh-ninos-05.jpg", "vh-ninos-06.jpg"]),
    "chaleco-airbag-mlv3-h-juvenil-adulto": (EKV, [
        "mlv3h-adulto-main.jpg", "mlv3h-adulto-02.jpg", "mlv3h-adulto-03.jpg",
        "mlv3h-adulto-04.jpg", "mlv3h-adulto-05.jpg", "mlv3h-adulto-06.jpg",
        "mlv3h-adulto-07.jpg"]),
    "chaleco-airbag-mlv3-h-ninos": (EKV, [
        "mlv3h-ninos-main.jpg", "mlv3h-ninos-02.jpg", "mlv3h-ninos-03.jpg",
        "mlv3h-ninos-04.jpg", "mlv3h-ninos-05.jpg", "mlv3h-ninos-06.jpg"]),
    "cartucho-de-co2-hit-air-50cc": (EKV, ["co2-50cc-main.jpg", "co2-comparativa.jpg"]),
    "cartucho-de-co2-hit-air-60cc": (EKV, ["co2-60cc-main.jpg", "co2-comparativa.jpg"]),
    "llave-de-resina-tipo-b-hit-air": (EKV, ["resin-keyball-main.jpg"]),
    "lanyard-bungee-all-in-one-hit-air": (EKV, [
        "lanyard-main.jpg", "lanyard-02.jpg", "lanyard-03.jpg", "lanyard-04.jpg",
        "lanyard-05.jpg", "lanyard-06.jpg"]),
    "hitair-coiled-wire-moto": (MOTO, [
        "coiled-wire-moto-main.jpg", "coiled-wire-moto-02.jpg", "coiled-wire-moto-03.jpg"]),
    "hitair-eu7-touring-jacket": (MOTO, [
        "eu7-main.jpg", "eu7-02.jpg", "eu7-03.jpg", "eu7-04.jpg", "eu7-05.jpg",
        "eu7-06.jpg", "eu7-07.jpg", "eu7-08.jpg"]),
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
        return {"__error__": e.read().decode()[:500], "__status__": e.code}


def head_ok(url):
    """Verifica que la foto responda antes de escribirla en Medusa."""
    try:
        r = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status == 200
    except Exception:
        return False


tok = req("POST", "/auth/user/emailpass", body={
    "email": os.environ["MEDUSA_EMAIL"], "password": os.environ["MEDUSA_PASSWORD"]})["token"]
print("Login OK\n")

prods = {p["handle"]: p for p in req(
    "GET", "/admin/products?limit=200&fields=id,title,handle,thumbnail,*images", tok)["products"]}

for handle, (base, archivos) in FIX.items():
    p = prods.get(handle)
    if not p:
        print("[!] no existe el handle %s, se salta" % handle)
        continue

    urls = ["%s/%s" % (base, a) for a in archivos]

    # 1. verificar que TODAS las fotos esten publicadas antes de tocar Medusa
    rotas = [u for u in urls if not head_ok(u)]
    if rotas:
        print("[ABORTA] %s: estas fotos aun no responden 200:" % p["title"])
        for u in rotas:
            print("           %s" % u)
        continue

    actuales = [i.get("url") for i in (p.get("images") or [])]
    if actuales == urls and p.get("thumbnail") == urls[0]:
        print("[OK-YA]  %s ya esta correcto" % p["title"])
        continue

    if DRY_RUN:
        print("[DRY] %s: %d fotos -> thumbnail %s" % (p["title"], len(urls), urls[0]))
        continue

    res = req("POST", "/admin/products/%s" % p["id"], tok, {
        "thumbnail": urls[0],
        "images": [{"url": u} for u in urls],
    })
    if "__error__" in res:
        print("[FALLO] %s: %s" % (p["title"], res))
    else:
        print("[ARREGLADO] %s -> %d fotos, thumbnail %s" % (p["title"], len(urls), archivos[0]))

print("\n=== VERIFICACION FINAL ===")
for p in req("GET", "/admin/products?limit=200&fields=id,title,thumbnail,*images", tok)["products"]:
    t = p.get("thumbnail") or ""
    imgs = [i.get("url", "") for i in (p.get("images") or [])]
    malas = [u for u in ([t] + imgs) if "localhost" in u or "hit-air.com" in u]
    estado = "ROTAS: %d" % len(malas) if malas else ("sin thumbnail" if not t else "ok")
    print("  %-55s %s (%d fotos)" % (p["title"][:55], estado, len(imgs)))
