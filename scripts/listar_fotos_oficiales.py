#!/usr/bin/env python3
"""Recorre el arbol de /for_shop_support/hit-air_collection/ y lista todas las
fotos oficiales disponibles, para poder elegir cuales reemplazan a las rotas."""
import re
import urllib.parse
import urllib.request

ROOTS = [
    "https://www.hit-air.com/for_shop_support/hit-air_collection/",
]
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
MAXDEPTH = 4


def get(u):
    r = urllib.request.Request(u, headers=UA)
    with urllib.request.urlopen(r, timeout=45) as resp:
        return resp.read().decode("utf-8", "replace")


seen = set()
files = []


def walk(url, depth=0):
    if depth > MAXDEPTH or url in seen:
        return
    seen.add(url)
    try:
        h = get(url)
    except Exception as e:
        print("[!] %s: %s" % (url, e))
        return
    for m in re.finditer(r'<a href="([^"]+)"', h):
        href = m.group(1)
        if href.startswith("?") or href.startswith("/") or href.startswith(".."):
            continue
        full = urllib.parse.urljoin(url, href)
        if href.endswith("/"):
            walk(full, depth + 1)
        elif re.search(r"\.(jpg|jpeg|png)$", href, re.I):
            files.append(full)


for r in ROOTS:
    walk(r)

print("TOTAL ARCHIVOS: %d\n" % len(files))
for f in sorted(files):
    print(f.replace("https://www.hit-air.com/for_shop_support/hit-air_collection/", ""))
