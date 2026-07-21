from __future__ import annotations

import argparse
import base64
import csv
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


SPREADSHEET_ID = "1Ipf8xjRIwbV5pPxtsiJsYNkMKsvaY2KkVDM_pJu7m1o"
SERVICE_ACCOUNT_FILE = Path("google-service-account.json")
SCOPE = "https://www.googleapis.com/auth/spreadsheets"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

SET_HEADERS = ["id", "title", "description", "tags", "createdAt", "updatedAt", "lastStudiedAt"]
CARD_HEADERS = [
    "setId",
    "id",
    "word",
    "ipa",
    "meaningVi",
    "definitionEn",
    "exampleEn",
    "exampleVi",
    "partOfSpeech",
    "level",
    "synonyms",
    "antonyms",
    "status",
    "mistakeCount",
    "correctCount",
    "starred",
    "lastStudiedAt",
    "nextReviewAt",
]
RESULT_HEADERS = ["id", "setId", "mode", "totalQuestions", "correctAnswers", "wrongAnswers", "accuracy", "studiedAt"]


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def load_credentials() -> dict[str, str]:
    if not SERVICE_ACCOUNT_FILE.exists():
        raise SystemExit(f"Missing credential file: {SERVICE_ACCOUNT_FILE}")
    return json.loads(SERVICE_ACCOUNT_FILE.read_text(encoding="utf-8"))


def access_token() -> str:
    creds = load_credentials()
    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    claim = {
        "iss": creds["client_email"],
        "scope": SCOPE,
        "aud": TOKEN_URL,
        "iat": now,
        "exp": now + 3600,
    }
    signing_input = f"{b64url(json.dumps(header, separators=(',', ':')).encode())}.{b64url(json.dumps(claim, separators=(',', ':')).encode())}".encode()
    private_key = serialization.load_pem_private_key(creds["private_key"].encode(), password=None)
    signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    assertion = signing_input.decode() + "." + b64url(signature)

    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": assertion,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["access_token"]


def sheets_request(method: str, path: str, token: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{SHEETS_BASE}/{SPREADSHEET_ID}{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def sheet_metadata(token: str) -> dict[str, Any]:
    return sheets_request("GET", "?includeGridData=false", token)


def sheet_titles(metadata: dict[str, Any]) -> dict[str, int]:
    return {sheet["properties"]["title"]: sheet["properties"]["sheetId"] for sheet in metadata.get("sheets", [])}


def print_inspect() -> None:
    token = access_token()
    meta = sheet_metadata(token)
    print(f"Spreadsheet: {meta.get('properties', {}).get('title', SPREADSHEET_ID)}")
    for sheet in meta.get("sheets", []):
        props = sheet["properties"]
        print(f"- {props['title']} id={props['sheetId']} rows={props.get('gridProperties', {}).get('rowCount')} cols={props.get('gridProperties', {}).get('columnCount')}")


def setup_schema() -> None:
    token = access_token()
    meta = sheet_metadata(token)
    titles = sheet_titles(meta)
    requests: list[dict[str, Any]] = []

    for title in ["sets", "cards", "results"]:
        if title not in titles:
            requests.append({"addSheet": {"properties": {"title": title}}})

    if requests:
        sheets_request("POST", ":batchUpdate", token, {"requests": requests})
        meta = sheet_metadata(token)
        titles = sheet_titles(meta)

    header_updates = [
        ("sets", SET_HEADERS),
        ("cards", CARD_HEADERS),
        ("results", RESULT_HEADERS),
    ]
    data = [{"range": f"{title}!A1:{chr(ord('A') + len(headers) - 1)}1", "values": [headers]} for title, headers in header_updates]
    sheets_request("POST", "/values:batchUpdate", token, {"valueInputOption": "RAW", "data": data})

    format_requests = []
    for title, headers in header_updates:
        sheet_id = titles[title]
        format_requests.extend([
            {
                "repeatCell": {
                    "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1},
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {"red": 0.31, "green": 0.27, "blue": 0.90},
                            "textFormat": {"foregroundColor": {"red": 1, "green": 1, "blue": 1}, "bold": True},
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,textFormat)",
                }
            },
            {"updateSheetProperties": {"properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}}, "fields": "gridProperties.frozenRowCount"}},
            {"autoResizeDimensions": {"dimensions": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": len(headers)}}},
        ])
    sheets_request("POST", ":batchUpdate", token, {"requests": format_requests})
    print("Schema is ready: sets, cards, results.")


def safe_json_list(value: str) -> str:
    parts = [item.strip() for item in value.split(";") if item.strip()]
    return json.dumps(parts, ensure_ascii=False)


def import_by_topic(csv_dir: Path, clear_existing: bool) -> None:
    token = access_token()
    setup_schema()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    set_rows: list[list[Any]] = []
    card_rows: list[list[Any]] = []

    for path in sorted(csv_dir.glob("*.csv")):
        set_id = path.stem
        title = path.stem.replace("_", " ").title()
        set_rows.append([set_id, title, f"Imported from {path.name}", json.dumps(["Imported"], ensure_ascii=False), now, now, ""])
        with path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            for index, row in enumerate(reader, 1):
                card_rows.append([
                    set_id,
                    f"{set_id}-{index:03d}",
                    row.get("word", ""),
                    row.get("ipa", ""),
                    row.get("meaningVi", ""),
                    row.get("definitionEn", ""),
                    row.get("exampleEn", ""),
                    row.get("exampleVi", ""),
                    row.get("partOfSpeech", "phrase"),
                    row.get("level", "IELTS"),
                    "[]",
                    "[]",
                    "new",
                    0,
                    0,
                    "FALSE",
                    "",
                    "",
                ])

    if clear_existing:
        sheets_request("POST", "/values:batchClear", token, {"ranges": ["sets!A2:G", "cards!A2:R", "results!A2:H"]})

    sheets_request("POST", "/values:batchUpdate", token, {
        "valueInputOption": "RAW",
        "data": [
            {"range": "sets!A2:G", "values": set_rows},
            {"range": "cards!A2:R", "values": card_rows},
        ],
    })
    print(f"Imported {len(set_rows)} sets and {len(card_rows)} cards from {csv_dir}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Admin Google Sheet for Local English Flashcards.")
    parser.add_argument("command", choices=["inspect", "setup-schema", "import-by-topic"])
    parser.add_argument("--csv-dir", default="exports/by_topic")
    parser.add_argument("--clear-existing", action="store_true")
    args = parser.parse_args()

    if args.command == "inspect":
        print_inspect()
    elif args.command == "setup-schema":
        setup_schema()
    elif args.command == "import-by-topic":
        import_by_topic(Path(args.csv_dir), args.clear_existing)


if __name__ == "__main__":
    main()
