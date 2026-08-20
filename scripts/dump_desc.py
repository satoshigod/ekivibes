#!/usr/bin/env python3
"""Vuelca la descripcion actual de los productos del canal Hit-Air Colombia."""
import json, os, urllib.request, urllib.error
BASE = "https://ekivibes-production.up.railway.app"
def req(m,p,t=None,b=None):
    d=json.dumps(b).encode() if b is not None else None
    r=urllib.request.Request(BASE+p,data=d,method=m); r.add_header("Content-Type","application/json")
    if t: r.add_header("Authorization","Bearer "+t)
    try:
        with urllib.request.urlopen(r,timeout=60) as x:
            raw=x.read().decode(); return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e: return {"__error__":e.read().decode()[:300],"__status__":e.code}
tok=req("POST","/auth/user/emailpass",b={"email":os.environ["MEDUSA_EMAIL"],"password":os.environ["MEDUSA_PASSWORD"]})["token"]
for p in req("GET","/admin/products?limit=200&fields=id,title,handle,description,*sales_channels",tok)["products"]:
    ch=[c["name"] for c in p.get("sales_channels") or []]
    if "Hit-Air Colombia" not in ch: continue
    d=p.get("description") or ""
    print("="*70)
    print("handle: %s" % p.get("handle"))
    print("titulo: %s" % p["title"])
    print("palabras: %d" % len(d.split()))
    print(d)
    print()
