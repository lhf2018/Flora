import { checkout } from "../../order/src/index.js";
import { describeSku } from "../../domain/src/index.js";

export function renderCart(sku: string) {
  return `${describeSku(sku)} => ${JSON.stringify(checkout(sku))}`;
}
