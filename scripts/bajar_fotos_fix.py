#!/usr/bin/env python3
"""Baja las fotos oficiales que reemplazan las imagenes rotas (localhost) y los hotlinks."""
import os
import urllib.request

BASE = "https://www.hit-air.com/for_shop_support/hit-air_collection/"
OUT = "ops/fix"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}

# destino_local : ruta_en_hit-air
MAPA = {
    # --- VH adulto (equitacion) ---
    "vh-adulto-main.jpg": "all-in-one_airbag/vh-vest/vh-m-f.jpg",
    "vh-adulto-02.jpg": "all-in-one_airbag/vh-vest/vh-m-b3.jpg",
    "vh-adulto-03.jpg": "all-in-one_airbag/vh-vest/vh-ff.jpg",
    "vh-adulto-04.jpg": "all-in-one_airbag/vh-vest/vh-bb.jpg",
    "vh-adulto-05.jpg": "all-in-one_airbag/vh-vest/vh-m-ab-f.jpg",
    "vh-adulto-06.jpg": "all-in-one_airbag/vh-vest/vh-m-ab-b.jpg",
    "vh-adulto-07.jpg": "all-in-one_airbag/vh-vest/vh-keybox.jpg",
    # --- VH ninos ---
    "vh-ninos-main.jpg": "all-in-one_airbag/vh-vest/Kids-XS/vh-xs-f.jpg",
    "vh-ninos-02.jpg": "all-in-one_airbag/vh-vest/Kids-XS/vh-xs-b.jpg",
    "vh-ninos-03.jpg": "all-in-one_airbag/vh-vest/Kids-XS/vh-kids-ff.jpg",
    "vh-ninos-04.jpg": "all-in-one_airbag/vh-vest/Kids-XS/vh-kids-bb.jpg",
    "vh-ninos-05.jpg": "all-in-one_airbag/vh-vest/Kids-XS/vh-xs-ab-f.jpg",
    "vh-ninos-06.jpg": "all-in-one_airbag/vh-vest/Kids-XS/vh-xs-keybox-op.jpg",
    # --- MLV3-H adulto ---
    "mlv3h-adulto-main.jpg": "all-in-one_airbag/mlv3-h/M/mlv3h-m-bk-f.jpg",
    "mlv3h-adulto-02.jpg": "all-in-one_airbag/mlv3-h/M/mlv3h-m-bk-b.jpg",
    "mlv3h-adulto-03.jpg": "all-in-one_airbag/mlv3-h/M/mlv3h-m-bk-ff.jpg",
    "mlv3h-adulto-04.jpg": "all-in-one_airbag/mlv3-h/M/mlv3h-m-bk-bb.jpg",
    "mlv3h-adulto-05.jpg": "all-in-one_airbag/mlv3-h/M/mlv3h-m-bk-ab-f.jpg",
    "mlv3h-adulto-06.jpg": "all-in-one_airbag/mlv3-h/M/mlv3h-m-bk-ab-b.jpg",
    "mlv3h-adulto-07.jpg": "all-in-one_airbag/mlv3-h/M/mlv3h-m-bk-kb.jpg",
    # --- MLV3-H ninos ---
    "mlv3h-ninos-main.jpg": "all-in-one_airbag/mlv3-h/mlv3h-k_kids/mlv3h-kids-f.jpg",
    "mlv3h-ninos-02.jpg": "all-in-one_airbag/mlv3-h/mlv3h-k_kids/mlv3h-kids-b.jpg",
    "mlv3h-ninos-03.jpg": "all-in-one_airbag/mlv3-h/mlv3h-k_kids/mlv3h-kids-ff.jpg",
    "mlv3h-ninos-04.jpg": "all-in-one_airbag/mlv3-h/mlv3h-k_kids/mlv3h-kids-bb.jpg",
    "mlv3h-ninos-05.jpg": "all-in-one_airbag/mlv3-h/mlv3h-k_kids/mlv3h-kids-ab-f.jpg",
    "mlv3h-ninos-06.jpg": "all-in-one_airbag/mlv3-h/mlv3h-k_kids/mlv3h-kids-keybox.jpg",
    # --- CO2 ---
    "co2-50cc-main.jpg": "option/CO2_gas_cartridge/co2-50cc_barcode.jpg",
    "co2-60cc-main.jpg": "option/CO2_gas_cartridge/co2-60cc_barcode.jpg",
    "co2-comparativa.jpg": "option/CO2_gas_cartridge/co2-60-50cc2026.jpg",
    # --- Llave de resina tipo B ---
    "resin-keyball-main.jpg": "option/Resin-Keyball_type-B/resin-keyball.jpg",
    "resin-keyball-02.jpg": "option/Resin-Keyball_type-B/resin-keyball-contents.jpg",
    # --- Lanyard bungee all-in-one ---
    "lanyard-main.jpg": "option/All-in-one-Bungee-Lanyard/all-BL-only.jpg",
    "lanyard-02.jpg": "option/All-in-one-Bungee-Lanyard/All-in-one-BL.jpg",
    "lanyard-03.jpg": "option/All-in-one-Bungee-Lanyard/all-BL_BL+Strap.jpg",
    "lanyard-04.jpg": "option/All-in-one-Bungee-Lanyard/all-Strap-only.jpg",
    "lanyard-05.jpg": "option/All-in-one-Bungee-Lanyard/for_saddle1.jpg",
    "lanyard-06.jpg": "option/All-in-one-Bungee-Lanyard/for_saddle2.jpg",
    # --- Cable en espiral moto ---
    "coiled-wire-moto-main.jpg": "option/Coiled_wire_MC/Coiled_wire.jpg",
    "coiled-wire-moto-02.jpg": "option/Coiled_wire_MC/MC_O-T-C_1.jpg",
    "coiled-wire-moto-03.jpg": "option/Coiled_wire_MC/MC_O-T-C_2.jpg",
    # --- EU7 (auto-hospedar, hoy hotlinkea) ---
    "eu7-main.jpg": "airbag_jacket/eu-7/eu7-black/eu7-bk-f.jpg",
    "eu7-02.jpg": "airbag_jacket/eu-7/eu7-black/eu7-bk-b.jpg",
    "eu7-03.jpg": "airbag_jacket/eu-7/eu7-black/eu7-bk-ff.jpg",
    "eu7-04.jpg": "airbag_jacket/eu-7/eu7-black/eu7-bk-ab-f.jpg",
    "eu7-05.jpg": "airbag_jacket/eu-7/eu7-black/eu7-bk-keybox-op.jpg",
    "eu7-06.jpg": "airbag_jacket/eu-7/eu7-dark-gray/eu7-dgy-f.jpg",
    "eu7-07.jpg": "airbag_jacket/eu-7/eu7-dark-gray/eu7-dgy-b.jpg",
    "eu7-08.jpg": "airbag_jacket/eu-7/eu7-dark-gray/eu7-dgy-ab-f.jpg",
}

os.makedirs(OUT, exist_ok=True)
ok = fail = 0
for dest, rel in MAPA.items():
    url = BASE + urllib.parse.quote(rel) if False else BASE + rel
    try:
        r = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(r, timeout=45) as resp:
            data = resp.read()
        with open(os.path.join(OUT, dest), "wb") as f:
            f.write(data)
        print("OK   %-28s %6d KB  <- %s" % (dest, len(data) // 1024, rel))
        ok += 1
    except Exception as e:
        print("FALLO %-28s <- %s : %s" % (dest, rel, e))
        fail += 1
print("\nok=%d fallos=%d" % (ok, fail))
