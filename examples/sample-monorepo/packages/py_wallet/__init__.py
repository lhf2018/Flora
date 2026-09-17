"""Sample Python package for Flora multi-language adapter demo."""

from .billing import charge


def payout(amount: float) -> dict:
    return charge(amount)
