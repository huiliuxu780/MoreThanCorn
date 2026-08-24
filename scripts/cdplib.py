"""Round-5 CDP 采集小库（只读产品数据；草稿级变更遵循既有调研惯例，留 TEST 痕迹供清理）。"""
import json, time, asyncio, urllib.parse, urllib.request

import websockets

CDP = "http://127.0.0.1:9222"


def pages():
    return [t for t in json.load(urllib.request.urlopen(f"{CDP}/json/list")) if t["type"] == "page"]


class Tab:
    def __init__(self, ws):
        self.ws = ws
        self.mid = 0
        self.pending = {}
        self.events = []
        self.net = []          # {url, method, postData, status, body}
        self._task = None

    @classmethod
    async def open(cls, url):
        req = urllib.request.Request(f"{CDP}/json/new?{urllib.parse.quote(url, safe='')}", method="PUT")
        t = json.load(urllib.request.urlopen(req))
        ws = await websockets.connect(t["webSocketDebuggerUrl"], max_size=50 * 1024 * 1024)
        tab = cls(ws)
        tab.target_id = t["id"]
        await tab._pump_start()
        await tab.send("Network.enable", {})
        await tab.send("Page.enable", {})
        await tab.send("Runtime.enable", {})
        return tab

    @classmethod
    async def attach(cls, url_substr):
        pg = next(t for t in pages() if url_substr in t["url"])
        ws = await websockets.connect(pg["webSocketDebuggerUrl"], max_size=50 * 1024 * 1024)
        tab = cls(ws)
        tab.target_id = pg["id"]
        await tab._pump_start()
        await tab.send("Network.enable", {})
        await tab.send("Page.enable", {})
        await tab.send("Runtime.enable", {})
        return tab

    async def _pump_start(self):
        self.fail_patterns = []

        def _paused_should_fail(m):
            url = m["params"].get("request", {}).get("url", "")
            return any(p in url for p in self.fail_patterns)

        self._paused_should_fail = _paused_should_fail

        async def pump():
            async for raw in self.ws:
                m = json.loads(raw)
                if "id" in m and m["id"] in self.pending:
                    self.pending[m["id"]].set_result(m)
                elif "method" in m:
                    self.events.append(m)
                    if m["method"] == "Fetch.requestPaused":
                        rid = m["params"]["requestId"]
                        if self._paused_should_fail(m):
                            asyncio.ensure_future(self.send("Fetch.failRequest", {"requestId": rid}))
                        else:
                            asyncio.ensure_future(self.send("Fetch.continueRequest", {"requestId": rid}))
                    if m["method"] == "Network.requestWillBeSent":
                        r = m["params"]["request"]
                        self.net.append({"url": r["url"], "method": r["method"],
                                         "post": r.get("postData", ""), "status": None, "body": "",
                                         "reqId": m["params"]["requestId"]})
                    if m["method"] == "Network.responseReceived":
                        for e in self.net:
                            if e["reqId"] == m["params"]["response"]["status"] and False:
                                pass
                        for e in self.net:
                            if e["reqId"] == m["params"]["requestId"]:
                                e["status"] = m["params"]["response"]["status"]
                    if m["method"] == "Network.loadingFinished":
                        reqId = m["params"]["requestId"]
                        try:
                            body = await self.send("Network.getResponseBody", {"requestId": reqId})
                            for e in self.net:
                                if e["reqId"] == reqId:
                                    e["body"] = body.get("result", {}).get("body", "")[:20000]
                        except Exception:
                            pass
        self._task = asyncio.ensure_future(pump())

    async def send(self, method, params=None, timeout=15):
        self.mid += 1
        mid = self.mid
        fut = asyncio.get_event_loop().create_future()
        self.pending[mid] = fut
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        try:
            r = await asyncio.wait_for(fut, timeout)
        finally:
            self.pending.pop(mid, None)
        if "error" in r:
            raise RuntimeError(f"{method}: {r['error']}")
        return r.get("result", {})

    async def eval(self, expr, ctx=None):
        params = {"expression": expr, "returnByValue": True}
        if ctx:
            params["contextId"] = ctx
        r = await self.send("Runtime.evaluate", params)
        return r.get("result", {}).get("value")

    async def contexts(self):
        return [e["params"]["context"] for e in self.events
                if e["method"] == "Runtime.executionContextCreated"]

    async def frame_ctx(self, substr):
        """找 URL 含 substr 的 frame 对应的 execution context id。"""
        tree = await self.send("Page.getFrameTree")
        ids = []

        def walk(f):
            if substr in f["frame"].get("url", ""):
                ids.append(f["frame"]["id"])
            for c in f.get("childFrames", []):
                walk(c)

        walk(tree["frameTree"])
        for c in await self.contexts():
            if c.get("auxData", {}).get("frameId") in ids:
                return c["id"]
        return None

    async def shot(self, path):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        import base64
        open(path, "wb").write(base64.b64decode(r["data"]))

    async def click(self, x, y):
        await self.send("Input.dispatchMouseEvent",
                        {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
        await asyncio.sleep(0.08)
        await self.send("Input.dispatchMouseEvent",
                        {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})

    def api(self, substr=""):
        return [e for e in self.net if substr in e["url"] and not e["url"].endswith((".js", ".css", ".png"))]

    async def close(self):
        self._task.cancel()
        await self.ws.close()
        urllib.request.urlopen(f"{CDP}/json/close/{self.target_id}")
