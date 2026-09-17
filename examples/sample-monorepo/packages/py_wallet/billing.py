from . import ledger


def charge(amount: float) -> dict:
    ledger.record(amount)
    return {"ok": True, "amount": amount}
