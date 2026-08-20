#!/usr/bin/env python3
"""Descarga imagenes y extrae fichas tecnicas de hit-air.com para los productos nuevos.
Corre en un runner de GitHub Actions (el sandbox de Claude no alcanza hit-air.com).
Salida: ops/img/<prefijo>-NN.<ext>  +  ops/scrape.txt
"""
import html
import os
import re
import urllib.parse
import urllib.request

OUT_IMG = "ops/img"
OUT_TXT = "ops/scrape.txt"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}

PRODUCTS = [
    ("pad-back-ym", "PAD-BACK-YM", [
        "https://www.hit-air.com/en/motorcycle/lineup/protector/protector_type05/pro-bp-ym.html",
        "https://www.hit-air.com/for_shop_support/hit-air_collection/protector/back-protector/ce-back-pad-ym/",
    ]),
    ("pad-back-ymcv", "PAD-BACK-YMCV", [
        "https://www.hit-air.com/en/motorcycle/lineup/protector/protector_type02/entry-748.html",
        "https://www.hit-air.com/for_shop_support/hit-air_collection/protector/back-protector/ce-back-pad-ym-cv/",
    ]),
    ("pad-chest-asc", "PAD-CHEST-ASC", [
        "https://www.hit-air.com/en/motorcycle/lineup/protector/protector_type01/asc.html",
        "https://www.hit-air.com/for_shop_support/hit-air_collection/protector/ce-chest-asc/",
    ]),
    ("pad-chest-hc", "PAD-CHEST-HC", [
        "https://www.hit-air.com/en/motorcycle/lineup/protector/protector_type01/pro-cp-hc.html",
        "https://www.hit-air.com/for_shop_support/hit-air_collection/protector/chest-protector/hc-chest-pad/",
    ]),
    ("conn-holder", "CONN-HOLDER", [
        "https://www.hit-air.com/en/motorcycle/lineup/option/option_type03/buckle-type-storage-connector.html",
        "https://www.hit-air.com/for_shop_support/hit-air_collection/option/conector-holder/",
    ]),
    ("tool-set", "TOOL-SET", [
        "https://www.hit-air.com/for_shop_support/hit-air_collection/option/Tool-set/",
        "https://www.hit-air.com/en/motorcycle/lineup/option/",
    ]),
]

EXTRA_DIRECT = {
    "pad-chest-hc": ["https://www.hit-air.com/for_shop_support/hit-air_collection/protector/chest-protector/hc-chest-pad/harness-yl+hc-f.jpg"],
    "conn-holder": ["https://www.hit-air.com/for_shop_support/hit-air_collection/option/conector-holder/conector2025.jpg"],
    "tool-set": [
        "https://www.hit-air.com/for_shop_support/hit-air_collection/option/Tool-set/tool-set-b.jpg",
        "https://www.hit-air.com/for_shop_support/hit-air_collection/option/Tool-set/tool-set-b_jp.jpg",
    ],
}

TAGS = re.compile(r"<(script|style|nav|header|footer)[^>]*>.*?</\1>", re.S | re.I)
STRIP = re.compile(r"<[^>]+>")


def get(url, binary=False):
    r = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(r, timeout=45) as resp:
        raw = resp.read()
    return raw if binary else raw.decode("utf-8", "replace")


def find_images(page_html, base):
    urls = []
    for m in re.finditer(r'(?:src|href)\s*=\s*["\']([^"\']+\.(?:jpg|jpeg|png))["\']', page_html, re.I):
        u = urllib.parse.urljoin(base, html.unescape(m.group(1)))
        if "/themes/" in u or "logo" in u.lower() or "pageup" in u.lower() or "catch.png" in u:
            continue
        if u not in urls:
            urls.append(u)
    return urls


def main_text(page_html):
    """Extrae el bloque util: titulo h1 + tabla de especificaciones."""
    out = []
    for m in re.finditer(r"<h1[^>]*>(.*?)</h1>", page_html, re.S | re.I):
        out.append("H1: " + STRIP.sub("", m.group(1)).strip())
    for m in re.finditer(r"<table[^>]*>(.*?)</table>", page_html, re.S | re.I):
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(1), re.S | re.I)
        for row in rows:
            cells = re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.S | re.I)
            cells = [re.sub(r"\s+", " ", html.unescape(STRIP.sub("", c))).strip() for c in cells]
            if any(cells):
                out.append("  | " + " | ".join(cells))
    body = TAGS.sub(" ", page_html)
    body = re.sub(r"\s+", " ", html.unescape(STRIP.sub(" ", body)))
    idx = body.find("Remarks")
    if idx > 0:
        out.append("CONTEXTO: " + body[idx:idx + 600])
    return "\n".join(out)


os.makedirs(OUT_IMG, exist_ok=True)
log = []

for prefix, sku, pages in PRODUCTS:
    log.append("\n" + "=" * 70)
    log.append(f"### {sku}  (prefijo de archivo: {prefix})")
    log.append("=" * 70)
    img_urls = []
    for p in pages:
        try:
            h = get(p)
        except Exception as e:
            log.append(f"[!] no se pudo leer {p}: {e}")
            continue
        log.append(f"\n--- pagina: {p}")
        txt = main_text(h)
        if txt.strip():
            log.append(txt)
        for u in find_images(h, p):
            if u not in img_urls:
                img_urls.append(u)
    for u in EXTRA_DIRECT.get(prefix, []):
        if u not in img_urls:
            img_urls.insert(0, u)

    log.append(f"\n--- imagenes encontradas: {len(img_urls)}")
    n = 0
    for u in img_urls:
        ext = os.path.splitext(urllib.parse.urlparse(u).path)[1].lower() or ".jpg"
        n += 1
        name = f"{prefix}-{n:02d}{ext}"
        try:
            data = get(u, binary=True)
        except Exception as e:
            log.append(f"[!] fallo descarga {u}: {e}")
            n -= 1
            continue
        if len(data) < 2500:
            log.append(f"[skip muy pequena {len(data)}B] {u}")
            n -= 1
            continue
        with open(os.path.join(OUT_IMG, name), "wb") as f:
            f.write(data)
        log.append(f"  {name}  <-  {u}  ({len(data)//1024} KB)")

with open(OUT_TXT, "w") as f:
    f.write("\n".join(log))
print("\n".join(log[:40]))
print("... completo en", OUT_TXT)
