from . import ledger


def charge(amount: float) -> dict:
    ledger.record(amount)
    return {"ok": True, "amount": amount}


class _App:
    def post(self, path: str):
        def deco(fn):
            return fn

        return deco

    def get(self, path: str):
        def deco(fn):
            return fn

        return deco


app = _App()


@app.post("/api/wallet/charge")
def wallet_charge(amount: float) -> dict:
    return charge(amount)
