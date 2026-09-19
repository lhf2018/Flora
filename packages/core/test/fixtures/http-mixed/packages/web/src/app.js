export async function boot() {
  await fetch("/api/orders");
  await fetch("/api/orders/42");
  await fetch("/api/catalog");
  await fetch("/api/wallet/charge", { method: "POST" });
}
