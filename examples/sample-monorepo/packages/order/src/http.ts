import { fetchOrder } from "./index.js";

/** Express-style route so Flora can match frontend fetch("/api/orders"). */
export function mountOrderRoutes(app: {
  get: (path: string, handler: (...args: unknown[]) => unknown) => void;
}) {
  app.get("/api/orders", () => []);
  app.get("/api/orders/:id", (id: unknown) => fetchOrder(String(id)));
}
