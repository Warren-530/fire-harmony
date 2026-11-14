"""The relay for local tests (Python standard library only): the same rules and models as the Apps Script relay (app/public/assistant.json), on http://127.0.0.1:8787.
Usage: .venv/bin/python assistant/dev_relay.py   (reads GEMINI_API_KEY from ~/nasa_work/.env, never prints it)"""
import json
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RULES = json.loads((Path(__file__).parents[1] / "app" / "public" / "assistant.json").read_text())
KEY = next(l.split("=", 1)[1].strip().strip("\"'") for l in (Path.home() / "nasa_work/.env").read_text().splitlines()
           if l.startswith("GEMINI_API_KEY="))
MODELS = RULES["models"]


class Relay(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("Access-Control-Allow-Origin", self.headers.get("origin") or "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        self._send(200, {"ok": True, "dev": True})

    def do_POST(self):
        contents = json.loads(self.rfile.read(int(self.headers["content-length"])))["contents"]
        payload = {"systemInstruction": {"parts": [{"text": RULES["system"]}]}, "contents": contents,
                   "tools": [{"functionDeclarations": RULES["tools"]}],
                   "generationConfig": {"thinkingConfig": {"thinkingLevel": "low"}, "maxOutputTokens": 2048}}
        d = None
        for m in MODELS:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"
            req = urllib.request.Request(url, json.dumps(payload).encode(), {"content-type": "application/json", "x-goog-api-key": KEY})
            try:
                d = json.loads(urllib.request.urlopen(req, timeout=60).read())
                break
            except urllib.error.HTTPError as e:
                if e.code not in (429, 503):
                    return self._send(502, {"error": "model", "status": e.code})
        if d is None:
            return self._send(429, {"error": "busy"})
        cand = (d.get("candidates") or [{}])[0]
        self._send(200 if cand.get("content") else 502, {"content": cand.get("content"), "finish": cand.get("finishReason")})

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", 8787), Relay).serve_forever()
