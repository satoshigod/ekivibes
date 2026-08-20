#!/usr/bin/env python3
"""
Llave de Resina Tipo B: reparte el contenido segun el patron de la tienda.

  - Arriba (Medusa): descripcion media, el gancho y la advertencia clave.
  - Abajo (product-details-data.ts): diagrama traducido, verificacion de
    insercion, nota de incompatibilidad y tabla de especificaciones.

Ademas suma a la galeria el diagrama en espanol, que hasta ahora estaba
excluido por estar en ingles.
"""
import json, os, urllib.request, urllib.error

BASE = "https://ekivibes-production.up.railway.app"
EKV = "https://ekivibes-storefront-production.up.railway.app/product-details"
HANDLE = "llave-de-resina-tipo-b-hit-air"
DRY_RUN = os.environ.get("DRY_RUN", "") == "1"

IMAGENES = ["%s/resin-keyball-main.jpg" % EKV, "%s/resin-keyball-02.jpg" % EKV]

DESCRIPCION = (
    "Llave de resina Tipo B, repuesto original Hit-Air para chalecos airbag de jinetes de poco peso. "
    "La llave metalica estandar necesita cierta fuerza para salir de la Key Box, y en un jinete "
    "liviano una caida puede no generar ese tiron. Esta version esta calibrada para liberarse con "
    "menos tension y cubrir justamente ese caso. Por lo mismo hay que revisarla antes de cada salida: "
    "al ser mas sensible, puede soltarse con un tiron leve del cable durante el uso normal. No es "
    "intercambiable con las llaves metalicas."
)

SUBTITULO = "Repuesto original Hit-Air para jinetes de poco peso"


def req(m, p, t=None, b=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=d, method=m)
    r.add_header("Content-Type", "application/json")
    if t:
        r.add_header("Authorization", "Bearer " + t)
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            raw = x.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"__error__": e.read().decode()[:400], "__status__": e.code}


def foto_ok(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, method="HEAD"), timeout=25) as r:
            return r.status == 200
    except Exception:
        return False


tok = req("POST", "/auth/user/emailpass", b={
    "email": os.environ["MEDUSA_EMAIL"], "password": os.environ["MEDUSA_PASSWORD"]})["token"]
print("Login OK\n")

rotas = [u for u in IMAGENES if not foto_ok(u)]
if rotas:
    raise SystemExit("Estas fotos aun no responden 200, se aborta: %s" % rotas)
print("Fotos verificadas: %d/%d\n" % (len(IMAGENES), len(IMAGENES)))

p = next((x for x in req("GET", "/admin/products?limit=200&fields=id,title,handle,description,subtitle,*images", tok)["products"]
          if x["handle"] == HANDLE), None)
if not p:
    raise SystemExit("No se encontro %s" % HANDLE)

print("descripcion: %d -> %d palabras" % (len((p.get("description") or "").split()), len(DESCRIPCION.split())))
print("galeria:     %d -> %d fotos" % (len(p.get("images") or []), len(IMAGENES)))

if DRY_RUN:
    print("\n[DRY] sin cambios")
else:
    res = req("POST", "/admin/products/%s" % p["id"], tok, {
        "description": DESCRIPCION,
        "subtitle": SUBTITULO,
        "thumbnail": IMAGENES[0],
        "images": [{"url": u} for u in IMAGENES],
    })
    print("\n-> %s" % ("FALLO: %s" % res if "__error__" in res else "actualizado"))

f = next((x for x in req("GET", "/admin/products?limit=200&fields=id,title,handle,description,subtitle,*images", tok)["products"]
          if x["handle"] == HANDLE), None)
print("\n=== ESTADO FINAL ===")
print("  titulo:      %s" % f["title"])
print("  subtitulo:   %s" % f.get("subtitle"))
print("  descripcion: %d palabras" % len((f.get("description") or "").split()))
for i in f.get("images") or []:
    print("  foto: %s" % i["url"])
