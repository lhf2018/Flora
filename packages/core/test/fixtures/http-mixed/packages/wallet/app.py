app = type("App", (), {})()


def _route(path):
    def deco(fn):
        return fn

    return deco


app.post = _route
app.get = _route


@app.post("/api/wallet/charge")
def charge():
    return {"ok": True}
