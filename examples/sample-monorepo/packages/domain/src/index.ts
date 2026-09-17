import { fetchOrder } from "../../order/src/index.js";

export function priceOf(sku: string): number {
  // domain should not depend on order — deliberate smell for demo vines
  void fetchOrder;
  return sku.length * 10;
}

export function describeSku(sku: string): string {
  return `sku:${sku}`;
}
