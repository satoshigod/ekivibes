#!/usr/bin/env python3
"""Diagnostico: que productos tiene cada categoria y que ve la Store API."""
import json, os, urllib.request, urllib.error
BASE="https://ekivibes-production.up.railway.app"
def req(m,p,h=None,b=None):
    d=json.dumps(b).encode() if b is not None else None
    r=urllib.request.Request(BASE+p,data=d,method=m); r.add_header("Content-Type","application/json")
    for k,v in (h or {}).items(): r.add_header(k,v)
    try:
        with urllib.request.urlopen(r,timeout=60) as x:
            raw=x.read().decode(); return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e: return {"__error__":e.read().decode()[:300],"__status__":e.code}
tok=req("POST","/auth/user/emailpass",b={"email":os.environ["MEDUSA_EMAIL"],"password":os.environ["MEDUSA_PASSWORD"]})["token"]
adm={"Authorization":"Bearer "+tok}

print("=== CATEGORIAS Y SUS PRODUCTOS (Admin) ===")
prods=req("GET","/admin/products?limit=200&fields=id,title,handle,*categories,*sales_channels",adm)["products"]
porcat={}
for p in prods:
    for c in p.get("categories") or []:
        porcat.setdefault(c["name"],[]).append(p["handle"])
for c in sorted(porcat):
    print("\n%s (%d):" % (c,len(porcat[c])))
    for h in sorted(porcat[c]): print("   ",h)
sin=[p["handle"] for p in prods if not (p.get("categories") or [])]
print("\nSIN CATEGORIA (%d): %s" % (len(sin), sin))

print("\n=== CO2: estado detallado ===")
for p in prods:
    if "co2" not in p["handle"]: continue
    print("  %s" % p["handle"])
    print("     categorias: %s" % [c["name"] for c in p.get("categories") or []])
    print("     canales:    %s" % [c["name"] for c in p.get("sales_channels") or []])

print("\n=== STORE API: categoria accesorios-moto ===")
keys={}
for k in req("GET","/admin/api-keys?limit=50&type=publishable&fields=id,token,*sales_channels",adm).get("api_keys",[]):
    for sc in k.get("sales_channels") or []: keys.setdefault(sc["name"],k["token"])
tk=keys.get("Hit-Air Colombia")
cats=req("GET","/store/product-categories?limit=50",{"x-publishable-api-key":tk}).get("product_categories",[])
print("categorias visibles en la tienda: %s" % [c.get("handle") for c in cats])
cid=next((c["id"] for c in cats if c.get("handle")=="accesorios-moto"),None)
print("id accesorios-moto: %s" % cid)
if cid:
    d=req("GET","/store/products?limit=100&category_id[]=%s&fields=id,title,handle"%cid,{"x-publishable-api-key":tk})
    print("productos que devuelve la tienda en esa categoria: %d" % len(d.get("products",[])))
    for p in d.get("products",[]): print("   ",p["handle"])
