// lib/odooClient.ts

// Variables de entorno necesarias (en Vercel):
// ODOO_URL     = https://axcel.odoo.com
// ODOO_DB      = solutto-consulting-axcel-17-0-12745094
// ODOO_UID     = 2
// ODOO_API_KEY = 9b682d6ca74a7194c7f9978730989d136a9f9466 (ejemplo)

const ODOO_URL = process.env.ODOO_URL!;
const ODOO_DB = process.env.ODOO_DB!;
const ODOO_UID = Number(process.env.ODOO_UID!);
const ODOO_API_KEY = process.env.ODOO_API_KEY!;

if (!ODOO_URL || !ODOO_DB || !ODOO_UID || !ODOO_API_KEY) {
  console.warn(
    "[OdooClient] Faltan variables de entorno (ODOO_URL, ODOO_DB, ODOO_UID, ODOO_API_KEY)"
  );
}

/**
 * Llamada genérica JSON-RPC a Odoo
 */
async function odooRpc<T = any>(
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {}
): Promise<T> {
  const body = {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs],
    },
    id: Date.now(),
  };

  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.error) {
    console.error("[Odoo error]", data.error);
    throw new Error(
      data.error.data?.message || data.error.message || "Odoo RPC error"
    );
  }
  return data.result;
}

/**
 * Solo para testear (ya lo usaste en /api/odoo-test)
 */
export async function findProductsBySku(skus: string[]) {
  if (!skus.length) return [];
  const domain = [["default_code", "in", skus]];
  const fields = ["id", "name", "default_code", "list_price"];
  const products = await odooRpc("product.product", "search_read", [
    domain,
    fields,
  ]);
  return products as Array<{
    id: number;
    name: string;
    default_code: string;
    list_price: number;
  }>;
}

/**
 * Productos de Odoo para sincronizar con Shopify
 * (llantas PAY...)
 */
export type OdooProductForSync = {
  id: number;
  name: string;
  default_code: string;
  list_price: number;
  description_sale?: string;
};

/**
 * Traer una página de productos desde Odoo
 * - Solo llantas: default_code que empiece por "PAY"
 * - Usado por /api/sync-products y /api/sync-stock
 */
export async function getOdooProductsPage(
  limit = 20,
  offset = 0
): Promise<OdooProductForSync[]> {
  const domain = [
    ["default_code", "ilike", "PAY%"], // SKUs que arrancan con PAY
    // Si quieres solo vendibles, descomenta:
    // ["sale_ok", "=", true],
  ];
  const fields = ["id", "name", "default_code", "list_price", "description_sale"];

  const products = await odooRpc("product.product", "search_read", [
    domain,
    fields,
  ], {
    limit,
    offset,
  });

  return products as OdooProductForSync[];
}

/**
 * Línea de stock por producto
 */
export type OdooStockLine = {
  default_code: string;
  qty_available: number;
};

/**
 * Obtener stock (qty_available) en Odoo por lista de SKUs
 */
export async function getOdooStockBySkus(
  skus: string[]
): Promise<OdooStockLine[]> {
  if (!skus.length) return [];

  const domain = [["default_code", "in", skus]];
  const fields = ["default_code", "qty_available"];

  const products = await odooRpc("product.product", "search_read", [
    domain,
    fields,
  ]);

  return (products as any[]).map((p) => ({
    default_code: p.default_code as string,
    qty_available: (p.qty_available as number) ?? 0,
  }));
}

/**
 * Línea de precios por producto (desde una lista de precios)
 */
export type OdooPriceLine = {
  default_code: string;
  price: number;
};

/**
 * Obtener precios desde una lista de precios específica
 * para una lista de SKUs (default_code).
 *
 * Se basa en product.pricelist.item con compute_price = 'fixed'.
 *
 * - pricelistId: ID de la lista de precios (ej: 625 para "Precios Full")
 * - skus: lista de default_code (PAY...)
 */
export async function getPricesFromPricelistForSkus(
  pricelistId: number,
  skus: string[]
): Promise<OdooPriceLine[]> {
  if (!skus.length) return [];

  // 1) Buscar productos por default_code
  const productDomain = [["default_code", "in", skus]];
  const productFields = ["id", "default_code"];

  const products = (await odooRpc(
    "product.product",
    "search_read",
    [productDomain, productFields]
  )) as Array<{ id: number; default_code: string }>;

  if (!products.length) return [];

  const productIds: number[] = [];
  const productIdBySku = new Map<string, number>();

  for (const p of products) {
    productIds.push(p.id);
    productIdBySku.set(p.default_code, p.id);
  }

  // 2) Traer líneas de la lista de precios para esos product_id
  const itemDomain = [
    ["pricelist_id", "=", pricelistId],
    ["product_id", "in", productIds],
  ];
  const itemFields = ["product_id", "compute_price", "fixed_price"];

  const items = (await odooRpc(
    "product.pricelist.item",
    "search_read",
    [itemDomain, itemFields]
  )) as Array<{
    product_id: [number, string] | number;
    compute_price: string;
    fixed_price: number;
  }>;

  const priceByProductId = new Map<number, number>();

  for (const item of items) {
    const prodId = Array.isArray(item.product_id)
      ? item.product_id[0]
      : item.product_id;

    if (item.compute_price === "fixed") {
      priceByProductId.set(prodId, item.fixed_price);
    }
  }

  const result: OdooPriceLine[] = [];

  for (const p of products) {
    const price = priceByProductId.get(p.id);
    if (price != null) {
      result.push({
        default_code: p.default_code,
        price,
      });
    }
  }

  return result;
}
