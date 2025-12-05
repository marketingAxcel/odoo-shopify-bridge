const ODOO_URL = process.env.ODOO_URL!;
const ODOO_DB = process.env.ODOO_DB!;
const ODOO_UID = Number(process.env.ODOO_UID!);
const ODOO_API_KEY = process.env.ODOO_API_KEY!;


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
    console.error("Odoo error:", data.error);
    throw new Error(
      data.error.data?.message || data.error.message || "Odoo RPC error"
    );
  }
  return data.result;
}

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

// Tipito para productos que usaremos para Shopify
export type OdooProductForSync = {
  id: number;
  name: string;
  default_code: string;
  list_price: number;
  description_sale?: string;
};

/**
 * Traer productos de Odoo por páginas
 * - Solo productos de venta (sale_ok = true)
 * - Solo los que tienen default_code (SKU) definido
 */
export async function getOdooProductsPage(
  limit = 20,
  offset = 0
): Promise<OdooProductForSync[]> {
  const domain = [
    ["sale_ok", "=", true],
    ["default_code", "!=", false],
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

