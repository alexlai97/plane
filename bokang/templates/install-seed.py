#!/usr/bin/env python3
"""Install missing reviewed templates through the same public API used by AI.
Never overwrite existing templates (including user-edited defaults).
"""
import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", required=True)
parser.add_argument("--key-file", required=True)
args = parser.parse_args()
seed = json.loads(Path(__file__).with_name("ai-strategy-seed.json").read_text())
key = Path(args.key_file).read_text().strip()
url = f'{args.base_url.rstrip("/")}/api/v1/workspaces/{seed["workspace_slug"]}/projects/{seed["project_id"]}/work-item-templates/'
def request(method, suffix="", data=None):
    req = Request(url + suffix, data=json.dumps(data).encode() if data is not None else None, method=method, headers={"X-API-Key": key, "Content-Type": "application/json"})
    with urlopen(req, timeout=30) as response:
        return json.load(response)
existing = request("GET")["results"]
keys = {item["key"] for item in existing}
has_default = any(item["is_default"] for item in existing)
created = 0
for item in seed["templates"]:
    if item["key"] in keys:
        continue
    is_default = not has_default and item["key"] == seed["default_template_key"]
    request("POST", data={"key": item["key"], "name": item["name"], "description_html": item["description_html"], "recommended_member_ids": item["recommended_member_ids"], "is_default": is_default})
    has_default = has_default or is_default
    created += 1
print(f"Installed {created} missing templates; total {len(request('GET')['results'])}.")
