import { priceOf } from "../../domain/src/index.js";
import { charge } from "../../payment/src/index.js";

export function fetchOrder(id: string) {
  return { id, total: priceOf(id) };
}

export function checkout(id: string) {
  const order = fetchOrder(id);
  return charge(order.total);
}
