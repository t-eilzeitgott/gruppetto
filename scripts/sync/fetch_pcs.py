"""Lädt eine Seite mit dem TLS-Fingerabdruck eines echten Browsers (curl_cffi).

procyclingstats.com steht hinter Cloudflare: Anfragen von Servern mit Node-fetch oder curl
bekommen dort „Just a moment …“ (HTTP 403), mit Browser-Fingerabdruck kommt die Seite.
Aufruf: python3 fetch_pcs.py URL ZIELDATEI
Ausgabe: eine Zeile JSON {"status": …, "headers": {…}, "impersonate": …}, Seite in ZIELDATEI.
"""
import json
import sys

from curl_cffi import requests

url, target = sys.argv[1], sys.argv[2]
timeout = float(sys.argv[3]) if len(sys.argv) > 3 else 25.0
response = None
used = None
for profile in ("chrome", "safari", "firefox"):
    used = profile
    response = requests.get(
        url,
        impersonate=profile,
        timeout=timeout,
        allow_redirects=True,
        headers={"Accept-Language": "en-GB,en;q=0.9,de;q=0.8"},
    )
    if response.status_code not in (403, 429, 503):
        break

with open(target, "wb") as f:
    f.write(response.content)
skip = {"content-encoding", "content-length", "transfer-encoding", "set-cookie"}
headers = {k.lower(): v for k, v in response.headers.items() if k.lower() not in skip}
print(json.dumps({"status": response.status_code, "headers": headers, "impersonate": used}))
