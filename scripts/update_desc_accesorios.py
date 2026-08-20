#!/usr/bin/env python3
"""
Reescribe la descripcion de los 10 ACCESORIOS del canal Hit-Air Colombia a un
texto de extension media (70-110 palabras): que es, para que sirve y cual es su
diferenciador. La ficha tecnica, la compatibilidad y las advertencias pasan a
las secciones y tablas de product-details-data.ts, que se muestran abajo.

NO toca los 4 chalecos/chaquetas (MLV2-RC, HDS-MS, MX-9, EU7): ya tienen la
estructura correcta.

Tambien corrige la galeria de TOOL-SET: su segunda foto era del set tipo Y.
"""
import json
import os
import urllib.error
import urllib.request

BASE = "https://ekivibes-production.up.railway.app"
MOTO = "https://hitair-colombia-storefront-production.up.railway.app/product-details"
DRY_RUN = os.environ.get("DRY_RUN", "") == "1"

# Los 4 que NO se tocan, por si alguien amplia la lista por error.
INTOCABLES = {"hitair-mlv2-rc-vest-black", "hitair-hds-ms-jacket-black",
              "hitair-mx9-jacket-black", "hitair-eu7-touring-jacket"}

DESCRIPCIONES = {
    "protector-espalda-ce-ym-hitair":
        "El acolchado blando que traen de fábrica los chalecos y chaquetas Hit-Air protege del roce, "
        "pero no está certificado. Esta espaldera lo reemplaza y eleva la protección dorsal a CE "
        "EN1621-2 Nivel 2, el grado más alto de la norma europea. Está hecha en Memory Elastan, un "
        "material con memoria de forma que absorbe la energía del golpe y se recompone, así que sigue "
        "protegiendo después del primer impacto. Va dentro del bolsillo trasero de la prenda, sin "
        "herrajes ni modificaciones, y su perforado mantiene la ventilación en clima caliente.",

    "protector-espalda-ce-ym-funda-velcro-hitair":
        "La misma espaldera certificada CE EN1621-2 Nivel 2 en Memory Elastan, pero con funda exterior "
        "en nylon Ripstop y malla transpirable. La diferencia está en cómo se sujeta: esta versión se "
        "adhiere directamente al velcro del forro trasero, así que es la indicada cuando tu prenda no "
        "tiene bolsillo para espaldera. Es compatible con modelos como MLV-C, VHR y los arneses "
        "Harness-B. La funda se abre para extraer el protector cuando haya que lavar la prenda.",

    "protector-pecho-ce-asc-hitair":
        "El airbag cubre el tórax con una cámara de aire; este par de protectores CE agrega encima una "
        "barrera rígida. Se instala en los bolsillos pectorales de los chalecos y chaquetas Hit-Air que "
        "los traen, como MLV2-H, MLV2P y MX-9. El cuerpo en polietileno perforado reparte la energía del "
        "impacto sobre una superficie amplia en lugar de concentrarla en un punto, y la perforación deja "
        "circular el aire. Se venden siempre como juego de dos piezas, izquierda y derecha.",

    "protector-pecho-hc-hitair":
        "La opción más liviana de protección pectoral del catálogo Hit-Air: 190 gramos entre las dos "
        "piezas. Su estructura en panal de polipropileno y EVA sobre malla de poliéster se flexiona y se "
        "adapta al pecho en lugar de comportarse como una placa rígida, lo que la hace cómoda para uso "
        "diario en ciudad y para clima caliente. Se monta en los arneses y chalecos Hit-Air con anclaje "
        "pectoral, como Harness, MC5, MLV-C y HS3, y suma una barrera sobre el esternón y las costillas "
        "al trabajo del airbag.",

    "soporte-conector-tipo-hebilla-hitair":
        "El sistema Hit-Air se activa cuando el piloto se separa de la moto y el cable en espiral hace "
        "tensión. Para que eso funcione siempre igual, el conector tiene que quedar fijo en el mismo "
        "punto y trabajar en el ángulo correcto: de eso se encarga este soporte. Se instala con la cinta "
        "incluida sobre el chasis, el subchasis o cualquier punto firme según tu moto, sin perforar ni "
        "modificar nada. Una vez montado, engancharse y desengancharse toma un segundo. Es la versión "
        "2025 del accesorio original.",

    "set-herramientas-key-box-tipo-b-hitair":
        "Cuando el airbag se activa hay que rearmar el sistema: recolocar el cartucho de CO2 y volver a "
        "ajustar el perno de la Key Box. Este set trae exactamente las dos piezas necesarias para eso, "
        "el perno de ajuste y la llave hexagonal del calibre correcto. También es la herramienta del "
        "mantenimiento periódico y el repuesto si pierdes el perno o lo pasas de rosca. Sirve para "
        "prendas de equitación y de motociclismo, siempre que usen Key Box tipo B.",

    "hitair-coiled-wire-moto":
        "El cable en espiral es el vínculo mecánico entre el piloto y la moto: si el piloto sale "
        "despedido, la tensión del cable libera la llave de la Key Box y el airbag se infla. Todo el "
        "sistema es mecánico, sin electrónica ni baterías. Es también la pieza que más desgaste acumula, "
        "porque se estira y se recoge en cada subida y bajada, así que conviene revisarla con "
        "regularidad y reemplazarla cuando el resorte pierda recuperación o el forro se agriete. Esta es "
        "la versión para motociclismo.",

    "cartucho-de-co2-hit-air-50cc":
        "Cartucho de CO2 comprimido de 50cc, repuesto original Hit-Air. Es la cilindrada de los modelos "
        "de talla pequeña e infantil, y también de algunas chaquetas de moto como la EU7. Después de "
        "cada activación el cartucho queda vacío y hay que cambiarlo: hasta que no montes uno nuevo, la "
        "prenda no vuelve a inflarse. Se rosca a mano en la Key Box, sin herramientas. Verifica siempre "
        "la cilindrada que indica tu prenda antes de comprar, porque montar otra cambia la presión de "
        "inflado.",

    "cartucho-de-co2-hit-air-60cc":
        "Cartucho de CO2 comprimido de 60cc, repuesto original Hit-Air. Es la cilindrada de los modelos "
        "de talla adulta, como la serie MLV y los VH de adulto. Después de cada activación el cartucho "
        "queda vacío y debe reemplazarse: hasta que no montes uno nuevo, la prenda no vuelve a inflarse. "
        "Se rosca a mano en la Key Box, sin herramientas. Revisa la cilindrada indicada en tu prenda "
        "antes de comprar, porque usar una distinta cambia la presión de inflado.",

    "llave-bola-conector-hebilla-tipo-b-hitair":
        "La llave de bola es la pieza que queda insertada en la Key Box del chaleco o la chaqueta y "
        "libera el airbag cuando el cable en espiral hace tensión en una caída. Este set de repuesto "
        "trae la llave metálica y la hebilla conectora hembra tipo B, para cuando el conjunto se daña, "
        "se desgasta o se pierde. Sirve tanto para prendas de equitación como de motociclismo que usen "
        "sistema de hebilla. No incluye el cable en espiral, que se vende aparte.",
}

# TOOL-SET tenia como segunda foto el set tipo Y, que es OTRO producto.
GALERIAS = {
    "set-herramientas-key-box-tipo-b-hitair": ["%s/tool-set-main.jpg" % MOTO],
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

solapan = set(DESCRIPCIONES) & INTOCABLES
if solapan:
    raise SystemExit("La lista toca chalecos/chaquetas: %s. Abortando." % solapan)

prods = {p["handle"]: p for p in req(
    "GET", "/admin/products?limit=200&fields=id,title,handle,description,thumbnail,*images", tok)["products"]}

for handle, texto in DESCRIPCIONES.items():
    p = prods.get(handle)
    if not p:
        print("[!] no existe %s" % handle)
        continue
    body = {"description": texto}
    nueva_galeria = GALERIAS.get(handle)
    if nueva_galeria:
        body["thumbnail"] = nueva_galeria[0]
        body["images"] = [{"url": u} for u in nueva_galeria]

    antes = len((p.get("description") or "").split())
    if DRY_RUN:
        print("[DRY] %-45s %d -> %d palabras%s" % (
            handle, antes, len(texto.split()),
            "  + galeria %d fotos" % len(nueva_galeria) if nueva_galeria else ""))
        continue

    res = req("POST", "/admin/products/%s" % p["id"], tok, body)
    if "__error__" in res:
        print("[FALLO] %s: %s" % (handle, res))
    else:
        print("[OK] %-45s %d -> %d palabras%s" % (
            handle, antes, len(texto.split()),
            "  + galeria corregida" if nueva_galeria else ""))

print("\n=== ESTADO DEL CANAL HIT-AIR COLOMBIA ===")
for p in req("GET", "/admin/products?limit=200&fields=id,title,handle,description,*images,*sales_channels", tok)["products"]:
    if "Hit-Air Colombia" not in [c["name"] for c in p.get("sales_channels") or []]:
        continue
    marca = "(chaqueta/chaleco, sin tocar)" if p["handle"] in INTOCABLES else ""
    print("  %-45s %4d palabras  %2d fotos  %s" % (
        p["handle"][:45], len((p.get("description") or "").split()),
        len(p.get("images") or []), marca))
