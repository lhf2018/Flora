/** Cross-language HTTP client — Flora draws a vine to the matching server route. */
export async function loadOrder(id: string) {
  const res = await fetch(`/api/orders/${id}`);
  return res.json();
}

export async function chargeWallet(amount: number) {
  return fetch("/api/wallet/charge", {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
}

export async function loadCatalog() {
  const res = await fetch("/api/catalog");
  return res.json();
}
