import { fetchOrder } from "../../order/src/index.js";

export function charge(amount: number) {
  return { ok: true, amount };
}

/** deliberate cycle: payment → order → payment */
export function refund(orderId: string) {
  const order = fetchOrder(orderId);
  return { refunded: order.total };
}
