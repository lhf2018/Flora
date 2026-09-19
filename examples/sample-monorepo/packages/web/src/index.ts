import { checkout } from "../../order/src/index.js";
import { describeSku } from "../../domain/src/index.js";
import { loadOrder, chargeWallet } from "./api.js";

export function renderCart(sku: string) {
  void loadOrder(sku);
  void chargeWallet(1);
  return `${describeSku(sku)} => ${JSON.stringify(checkout(sku))}`;
}
