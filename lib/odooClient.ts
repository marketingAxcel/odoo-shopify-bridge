// lib/odooClient.ts

// Variables de entorno necesarias (en Vercel):
// ODOO_URL     = https://axcel.odoo.com
// ODOO_DB      = solutto-consulting-axcel-17-0-12745094
// ODOO_UID     = 2
// ODOO_API_KEY = xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// ODOO_PRICELIST_ID = 625   (por ejemplo, PRECIOSFULL)

const ODOO_URL = process.env.ODOO_URL!;
const ODOO_DB = process.env.ODOO_DB!;
const ODOO_UID = Number(process.env.ODOO_UID!);
const ODOO_API_KEY = process.env.ODOO_API_KEY!;
const ODOO_PRICELIST_ID = Number(process.env.ODOO_PRICELIST_ID || "0");

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
 * - Usado por /api/sync-products, /api/sync-stock y /api/sync-prices-all
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
  const fields = [
    "id",
    "name",
    "default_code",
    "list_price",
    "description_sale",
  ];

  const products = await odooRpc(
    "product.product",
    "search_read",
    [domain, fields],
    {
      limit,
      offset,
    }
  );

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

export type OdooPriceLine = {
  product_id: number;
  price: number;
};

/**
 * Trae los precios desde la lista de precios ODOO_PRICELIST_ID
 * (por ejemplo PRECIOSFULL) para un conjunto de IDs de productos.
 *
 * - Filtra por:
 *   - pricelist_id = ODOO_PRICELIST_ID
 *   - product_id IN productIds
 *   - compute_price = "fixed"
 *
 * Si no hay regla para un product_id, NO devuelve entrada para ese producto.
 */
export async function getOdooPricesByProductIds(
  productIds: number[]
): Promise<OdooPriceLine[]> {
  if (!productIds.length) return [];

  if (!ODOO_PRICELIST_ID) {
    console.warn(
      "[OdooClient] ODOO_PRICELIST_ID no está definido, no se traerán precios"
    );
    return [];
    // Si prefieres que reviente:
    // throw new Error("ODOO_PRICELIST_ID no está definido");
  }

  const domain = [
    ["pricelist_id", "=", ODOO_PRICELIST_ID],
    ["product_id", "in", productIds],
    ["compute_price", "=", "fixed"],
  ];

  const fields = ["product_id", "fixed_price"];

  const items = await odooRpc("product.pricelist.item", "search_read", [
    domain,
    fields,
  ]);

  return (items as any[]).map((it) => {
    const productField = it.product_id;
    const productId = Array.isArray(productField)
      ? (productField[0] as number)
      : (productField as number);

    const price =
      typeof it.fixed_price === "number" ? (it.fixed_price as number) : 0;

    return {
      product_id: productId,
      price,
    };
  });
}
