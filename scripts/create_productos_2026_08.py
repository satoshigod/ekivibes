#!/usr/bin/env python3
"""
Crea los 6 productos nuevos (protectores CE, soporte conector y set de
herramientas) en Medusa, vinculandolos a sus canales y categorias correctas.

Reglas duras del negocio que este script respeta:
  - Los 5 productos de moto van SOLO al canal "Hit-Air Colombia"
    (+ "Venta Directa", que es mostrador/mayorista, no un storefront publico).
  - TOOL-SET es generico: va a los DOS storefronts (Ekivibes + Hit-Air Colombia),
    igual que CO2-50CC / CO2-60CC / KEY-BALL-B.
  - Categorias: "Accesorios Moto" para el lado moto,
    "Repuestos y Accesorios Hit-Air" para el lado equitacion.

Idempotente: si el SKU ya existe, salta ese producto sin duplicar.
Se ejecuta desde GitHub Actions (workflow crear-productos.yml).
"""
import json
import os
import urllib.error
import urllib.request

BASE = "https://ekivibes-production.up.railway.app"
IMG_MOTO = "https://hitair-colombia-storefront-production.up.railway.app/product-details"
IMG_EKV = "https://ekivibes-storefront-production.up.railway.app/product-details"

CANAL_HITAIR = "Hit-Air Colombia"
CANAL_EKIVIBES = "TIENDA EKIVIBE COLOMBIA"
CANAL_DIRECTA = "Venta Directa (Mostrador y Mayorista)"
CAT_ACCESORIOS_MOTO = "Accesorios Moto"
CAT_ACCESORIOS_EQU = "Repuestos y Accesorios Hit-Air"

STOCK_INICIAL = int(os.environ.get("STOCK_INICIAL", "10"))
DRY_RUN = os.environ.get("DRY_RUN", "") == "1"

# ---------------------------------------------------------------------------
# PRECIOS — PVP en COP con IVA incluido.
# Formula de la casa (misma de seed-hitair-colombia.ts y create-keyball-set-b.ts):
#   PVP = costo NETO x 2.2   |   precio distribuidor = costo NETO x 1.45
# Los valores de abajo se calculan desde el costo neto que entregue Ivan.
# ---------------------------------------------------------------------------
# PROVISIONAL 2026-08-20: Ivan pidio cargar los 6 a $200.000 COP para poder ver
# los productos en las tiendas. NO son precios reales. Reemplazar por
# costo NETO x 2.2 en cuanto lleguen los costos de fabrica.
PRECIO_PROVISIONAL = 200000
PRECIOS = {
    "PAD-BACK-YM": PRECIO_PROVISIONAL,
    "PAD-BACK-YMCV": PRECIO_PROVISIONAL,
    "PAD-CHEST-ASC": PRECIO_PROVISIONAL,
    "PAD-CHEST-HC": PRECIO_PROVISIONAL,
    "CONN-HOLDER": PRECIO_PROVISIONAL,
    "TOOL-SET": PRECIO_PROVISIONAL,
}

PRODUCTOS = [
    {
        "sku": "PAD-BACK-YM",
        "title": "Protector de Espalda CE YM Hit-Air",
        "handle": "protector-espalda-ce-ym-hitair",
        "weight": 390,
        "img": IMG_MOTO,
        "slug": "pad-back-ym",
        "n_img": 6,
        "canales": [CANAL_HITAIR, CANAL_DIRECTA],
        "categorias": [CAT_ACCESORIOS_MOTO],
        "description": (
            "Protector de espalda original Hit-Air en material Memory Elastan, un acolchado con "
            "memoria de forma que absorbe el impacto y recupera su forma original despues del golpe. "
            "Certificacion CE EN1621-2 Nivel 2, el nivel mas alto de la norma europea para "
            "protectores dorsales de motociclismo.\n\n"
            "Esta version es la pieza desnuda, disenada para ir DENTRO del bolsillo trasero de los "
            "chalecos y chaquetas Hit-Air que ya vienen con ese bolsillo. Reemplaza el acolchado "
            "blando original de fabrica: se retira el acolchado suave y se inserta este protector CE "
            "en su lugar, elevando la proteccion dorsal al nivel 2 sin cambiar de prenda.\n\n"
            "Ficha tecnica:\n"
            "- Color: amarillo\n"
            "- Medidas: 255 mm de ancho x 395 mm de alto x 18 mm de espesor\n"
            "- Peso: 390 g\n"
            "- Material: poliuretano (Memory Elastan)\n"
            "- Norma: CE EN1621-2 Nivel 2\n"
            "- Perforado para ventilacion\n\n"
            "Importante: verifica que tu chaleco o chaqueta Hit-Air tenga bolsillo trasero para "
            "espaldera. Si tu prenda usa sujecion por velcro en lugar de bolsillo, necesitas la "
            "version con funda de velcro."
        ),
    },
    {
        "sku": "PAD-BACK-YMCV",
        "title": "Protector de Espalda CE YM con Funda Velcro Hit-Air",
        "handle": "protector-espalda-ce-ym-funda-velcro-hitair",
        "weight": 430,
        "img": IMG_MOTO,
        "slug": "pad-back-ymcv",
        "n_img": 6,
        "canales": [CANAL_HITAIR, CANAL_DIRECTA],
        "categorias": [CAT_ACCESORIOS_MOTO],
        "description": (
            "Protector de espalda original Hit-Air en material Memory Elastan con funda exterior "
            "de velcro. Misma pieza certificada CE EN1621-2 Nivel 2 que la version desnuda, pero "
            "cubierta con una funda en nylon Ripstop y malla transpirable que permite fijarla "
            "directamente al velcro del forro trasero de la prenda.\n\n"
            "Es la version indicada cuando tu chaleco o chaqueta Hit-Air NO tiene bolsillo trasero "
            "para espaldera, sino tiras o superficie de velcro (hembra) en el forro interior. "
            "Compatible con modelos tipo MLV-C, VHR y los arneses Harness-B, entre otros.\n\n"
            "Ficha tecnica:\n"
            "- Color: funda negra / cuerpo amarillo\n"
            "- Medidas: 255 mm de ancho x 395 mm de alto x 18 mm de espesor\n"
            "- Peso: 430 g\n"
            "- Material: funda en nylon Ripstop y malla de poliester; cuerpo en poliuretano\n"
            "- Norma: CE EN1621-2 Nivel 2\n\n"
            "La funda se abre para extraer el protector, lo que facilita la limpieza de la prenda."
        ),
    },
    {
        "sku": "PAD-CHEST-ASC",
        "title": "Protector de Pecho CE ASC Hit-Air (Par)",
        "handle": "protector-pecho-ce-asc-hitair",
        "weight": 300,
        "img": IMG_MOTO,
        "slug": "pad-chest-asc",
        "n_img": 6,
        "canales": [CANAL_HITAIR, CANAL_DIRECTA],
        "categorias": [CAT_ACCESORIOS_MOTO],
        "description": (
            "Par de protectores pectorales CE originales Hit-Air. Se venden como juego de dos "
            "piezas (lado izquierdo y derecho) y se instalan en los bolsillos pectorales de los "
            "chalecos y chaquetas Hit-Air, sumando proteccion rigida certificada sobre el torax "
            "a la proteccion neumatica del airbag.\n\n"
            "El cuerpo perforado en polietileno reparte la energia del impacto sobre una superficie "
            "amplia y mantiene la ventilacion, mientras la cubierta en poliester evita el roce "
            "directo contra la prenda.\n\n"
            "Ficha tecnica:\n"
            "- Color: negro\n"
            "- Medidas por pieza: 160 mm de ancho x 226 mm de alto x 17 mm de espesor\n"
            "- Peso: 300 g el juego de 2 piezas\n"
            "- Material: cuerpo en polietileno, cubierta en poliester\n"
            "- Presentacion: par (2 unidades)\n\n"
            "Compatible con los modelos Hit-Air que traen bolsillos pectorales, como MLV2-H, "
            "MLV2P y MX-9."
        ),
    },
    {
        "sku": "PAD-CHEST-HC",
        "title": "Protector de Pecho HC Hit-Air (Par)",
        "handle": "protector-pecho-hc-hitair",
        "weight": 190,
        "img": IMG_MOTO,
        "slug": "pad-chest-hc",
        "n_img": 6,
        "canales": [CANAL_HITAIR, CANAL_DIRECTA],
        "categorias": [CAT_ACCESORIOS_MOTO],
        "description": (
            "Protector pectoral HC original Hit-Air, la version mas liviana y flexible del catalogo "
            "de proteccion de torax. Estructura en panal de polipropileno y EVA sobre malla de "
            "poliester: se adapta al pecho, pesa poco y ventila bien, ideal para uso urbano y para "
            "clima calido.\n\n"
            "Se monta en los arneses y chalecos Hit-Air que cuentan con anclaje para pectoral, "
            "complementando el airbag con una barrera rigida sobre el esternon y las costillas.\n\n"
            "Ficha tecnica:\n"
            "- Color: negro\n"
            "- Medidas: 275 mm de ancho x 226 mm de alto\n"
            "- Peso: 190 g\n"
            "- Material: polipropileno, EVA y malla de poliester\n"
            "- Marcado CE en la pieza\n\n"
            "Compatible con arneses Harness y con modelos tipo MC5, MLV-C y HS3."
        ),
    },
    {
        "sku": "CONN-HOLDER",
        "title": "Soporte de Conector Tipo Hebilla Hit-Air",
        "handle": "soporte-conector-tipo-hebilla-hitair",
        "weight": 60,
        "img": IMG_MOTO,
        "slug": "conn-holder",
        "n_img": 3,
        "canales": [CANAL_HITAIR, CANAL_DIRECTA],
        "categorias": [CAT_ACCESORIOS_MOTO],
        "description": (
            "Soporte original Hit-Air para el conector tipo hebilla del cable en espiral. Es la "
            "pieza que se fija a la moto y sirve de punto de anclaje del cable que conecta al piloto "
            "con la motocicleta.\n\n"
            "Su funcion es doble: mantiene el conector siempre en el mismo lugar, para que engancharse "
            "y desengancharse al subir y bajar de la moto sea un gesto de un segundo; y asegura que el "
            "cable trabaje en el angulo correcto, que es lo que garantiza que el sistema se active si "
            "el piloto se separa de la moto en una caida.\n\n"
            "Se instala con la cinta de sujecion incluida sobre el chasis, el subchasis o el punto "
            "firme que elijas segun el modelo de moto. Version 2025.\n\n"
            "Nota: no incluye el cable en espiral, que se vende por separado."
        ),
    },
    {
        "sku": "TOOL-SET",
        "title": "Set de Herramientas Key Box Tipo B Hit-Air",
        "handle": "set-herramientas-key-box-tipo-b-hitair",
        "weight": 60,
        "img": IMG_MOTO,
        "slug": "tool-set",
        "n_img": 2,
        "canales": [CANAL_HITAIR, CANAL_EKIVIBES, CANAL_DIRECTA],
        "categorias": [CAT_ACCESORIOS_MOTO, CAT_ACCESORIOS_EQU],
        "description": (
            "Set de herramientas original Hit-Air para la Key Box tipo B: incluye el perno de "
            "ajuste y la llave hexagonal (allen) especifica del mecanismo.\n\n"
            "La Key Box es la caja donde se inserta la llave de activacion del airbag. Despues de "
            "que el chaleco o la chaqueta se activa, hay que rearmar el sistema y volver a ajustar "
            "el perno de la Key Box: para eso sirve este set. Tambien es la herramienta correcta "
            "para el mantenimiento periodico y para reemplazar un perno perdido o pasado de rosca.\n\n"
            "Contenido:\n"
            "- 1 perno de ajuste para Key Box tipo B\n"
            "- 1 llave hexagonal (allen) del calibre correspondiente\n\n"
            "Sirve tanto para los productos de equitacion como para los de motociclismo que usan "
            "Key Box tipo B. Verifica el tipo de Key Box de tu prenda antes de comprar; el tipo Y "
            "usa un set distinto."
        ),
    },
]


# ---------------------------------------------------------------------------
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
        raw = e.read().decode()
        try:
            return {"__error__": json.loads(raw), "__status__": e.code}
        except Exception:
            return {"__error__": raw[:600], "__status__": e.code}


def login():
    d = req("POST", "/auth/user/emailpass", body={
        "email": os.environ["MEDUSA_EMAIL"],
        "password": os.environ["MEDUSA_PASSWORD"],
    })
    if not d.get("token"):
        raise SystemExit("Login fallido: %s" % d)
    return d["token"]


def main():
    faltantes = [k for k, v in PRECIOS.items() if not v]
    if faltantes:
        raise SystemExit("Faltan precios para: %s. Abortando sin tocar nada." % ", ".join(faltantes))

    tok = login()
    print("Login OK\n")

    canales = {c["name"]: c["id"] for c in req("GET", "/admin/sales-channels?limit=50", tok)["sales_channels"]}
    cats = {c["name"]: c["id"] for c in req("GET", "/admin/product-categories?limit=100", tok)["product_categories"]}
    perfil = req("GET", "/admin/shipping-profiles?limit=5", tok)["shipping_profiles"][0]["id"]

    # Bodega: se toma la misma que ya usan los productos moto existentes,
    # para no dispersar el inventario entre ubicaciones.
    ref = req("GET", "/admin/products?limit=1&handle=hitair-mlv2-rc-vest-black&fields=*variants", tok)
    loc_id = None
    if ref.get("products"):
        vid = ref["products"][0]["variants"][0]["id"]
        inv = req("GET", "/admin/inventory-items?limit=5&sku=MLV2-RC-BLK-M&fields=*location_levels", tok)
        for it in inv.get("inventory_items", []):
            for lvl in it.get("location_levels", []):
                loc_id = lvl["location_id"]
    if not loc_id:
        locs = req("GET", "/admin/stock-locations?limit=10", tok)["stock_locations"]
        loc_id = locs[0]["id"]
    loc_nombre = next((s["name"] for s in req("GET", "/admin/stock-locations?limit=10", tok)["stock_locations"]
                       if s["id"] == loc_id), "?")
    print("Bodega destino: %s (%s)\n" % (loc_nombre, loc_id))

    # SKUs ya existentes -> se saltan
    existentes = set()
    for p in req("GET", "/admin/products?limit=200&fields=*variants", tok).get("products", []):
        for v in p.get("variants", []):
            if v.get("sku"):
                existentes.add(v["sku"])

    for pr in PRODUCTOS:
        sku = pr["sku"]
        if sku in existentes:
            print("[SALTA] %s ya existe." % sku)
            continue

        imgs = [{"url": "%s/%s-main.jpg" % (pr["img"], pr["slug"])}]
        for i in range(2, pr["n_img"] + 1):
            imgs.append({"url": "%s/%s-%02d.jpg" % (pr["img"], pr["slug"], i)})

        body = {
            "title": pr["title"],
            "handle": pr["handle"],
            "description": pr["description"],
            "status": "published",
            "weight": pr["weight"],
            "shipping_profile_id": perfil,
            "thumbnail": imgs[0]["url"],
            "images": imgs,
            "category_ids": [cats[c] for c in pr["categorias"] if c in cats],
            "sales_channels": [{"id": canales[c]} for c in pr["canales"] if c in canales],
            "options": [{"title": "Presentacion", "values": ["Estandar"]}],
            "variants": [{
                "title": "Estandar",
                "sku": sku,
                "options": {"Presentacion": "Estandar"},
                "manage_inventory": True,
                "prices": [{"amount": PRECIOS[sku], "currency_code": "cop"}],
            }],
        }

        if DRY_RUN:
            print("[DRY] %s -> %s | canales=%s | cats=%s | %d imgs | $%s"
                  % (sku, pr["title"], pr["canales"], pr["categorias"], len(imgs), PRECIOS[sku]))
            continue

        res = req("POST", "/admin/products", tok, body)
        if "__error__" in res:
            print("[FALLO] %s: %s" % (sku, res))
            continue
        print("[OK] creado %s -> %s" % (sku, res["product"]["id"]))

        # Inventario
        inv = req("GET", "/admin/inventory-items?limit=5&sku=%s" % sku, tok)
        items = inv.get("inventory_items", [])
        if not items:
            print("   [!] sin inventory item para %s, revisar en Admin" % sku)
            continue
        r2 = req("POST", "/admin/inventory-items/%s/location-levels" % items[0]["id"], tok,
                 {"location_id": loc_id, "stocked_quantity": STOCK_INICIAL})
        print("   inventario: %s uds en %s -> %s"
              % (STOCK_INICIAL, loc_nombre, "OK" if "__error__" not in r2 else r2))

    print("\n=== VERIFICACION ===")
    for p in req("GET", "/admin/products?limit=200&fields=id,title,status,*variants,*categories,*sales_channels", tok).get("products", []):
        skus = [v.get("sku") for v in p.get("variants", [])]
        if not any(s in PRECIOS for s in skus):
            continue
        print("- %s [%s] canales=%s cats=%s skus=%s" % (
            p["title"], p["status"],
            [c["name"] for c in p.get("sales_channels", [])],
            [c["name"] for c in p.get("categories", [])],
            skus))


main()
