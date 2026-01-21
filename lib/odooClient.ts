const ODOO_URL = process.env.ODOO_URL!;
const ODOO_DB = process.env.ODOO_DB!;
const ODOO_UID = Number(process.env.ODOO_UID!);
const ODOO_API_KEY = process.env.ODOO_API_KEY!;

if (!ODOO_URL || !ODOO_DB || !ODOO_UID || !ODOO_API_KEY) {
  console.warn(
    "[OdooClient] Faltan variables de entorno (ODOO_URL, ODOO_DB, ODOO_UID, ODOO_API_KEY)"
  );
}

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
  if ((data as any).error) {
    const err = (data as any).error;
    console.error("[Odoo error]", err);
    throw new Error(
      err.data?.message || err.message || "Odoo RPC error"
    );
  }
  return (data as any).result as T;
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

export type OdooProductForSync = {
  id: number;
  name: string;
  default_code: string;
  list_price: number;
  description_sale?: string;
  tire_name?: string;
};

export async function getOdooProductsPage(
  limit = 20,
  offset = 0
): Promise<OdooProductForSync[]> {
  const domain = [
    ["default_code", "ilike", "PAY%"],
  ];

  const fields = [
    "id",
    "name",
    "default_code",
    "list_price",
    "description_sale",
    "x_studio_nombre_de_la_llanta",
  ];

  const products = await odooRpc("product.product", "search_read", [
    domain,
    fields,
  ], {
    limit,
    offset,
  });

  return (products as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    default_code: p.default_code,
    list_price: p.list_price,
    description_sale: p.description_sale,
    tire_name: p.x_studio_nombre_de_la_llanta ?? "",
  })) as OdooProductForSync[];
}



export type OdooStockLine = {
  default_code: string;
  qty_available: number;
};

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
  default_code: string;
  price: number;
};

export async function getPricesFromPricelistForSkus(
  pricelistId: number,
  skus: string[]
): Promise<OdooPriceLine[]> {
  if (!skus.length) return [];

  const productDomain = [["default_code", "in", skus]];
  const productFields = ["id", "default_code", "product_tmpl_id", "categ_id"];

  const products = (await odooRpc(
    "product.product",
    "search_read",
    [productDomain, productFields]
  )) as Array<{
    id: number;
    default_code: string;
    product_tmpl_id: [number, string] | number | false;
    categ_id: [number, string] | number | false;
  }>;

  if (!products.length) return [];

  const tmplIdByProdId = new Map<number, number | null>();
  const categIdByProdId = new Map<number, number | null>();

  for (const p of products) {
    const tmplId = Array.isArray(p.product_tmpl_id)
      ? p.product_tmpl_id[0]
      : (p.product_tmpl_id as number | null);

    const categId = Array.isArray(p.categ_id)
      ? p.categ_id[0]
      : (p.categ_id as number | null);

    tmplIdByProdId.set(p.id, tmplId ?? null);
    categIdByProdId.set(p.id, categId ?? null);
  }

  const itemDomain = [["pricelist_id", "=", pricelistId]];
  const itemFields = [
    "product_id",
    "product_tmpl_id",
    "categ_id",
    "compute_price",
    "fixed_price",
  ];

  const items = (await odooRpc(
    "product.pricelist.item",
    "search_read",
    [itemDomain, itemFields]
  )) as Array<{
    product_id: [number, string] | number | false;
    product_tmpl_id: [number, string] | number | false;
    categ_id: [number, string] | number | false;
    compute_price: string;
    fixed_price: number;
  }>;

  const variantItems: Array<{ product_id: number; price: number }> = [];
  const tmplItems: Array<{ product_tmpl_id: number; price: number }> = [];
  const categItems: Array<{ categ_id: number; price: number }> = [];
  const globalItems: Array<{ price: number }> = [];

  for (const item of items) {
    if (item.compute_price !== "fixed") continue; // solo soportamos "Precio fijo"

    const hasProduct =
      !!item.product_id &&
      (Array.isArray(item.product_id) || typeof item.product_id === "number");
    const hasTemplate =
      !!item.product_tmpl_id &&
      (Array.isArray(item.product_tmpl_id) ||
        typeof item.product_tmpl_id === "number");
    const hasCategory =
      !!item.categ_id &&
      (Array.isArray(item.categ_id) || typeof item.categ_id === "number");

    if (hasProduct) {
      const pid = Array.isArray(item.product_id)
        ? item.product_id[0]
        : (item.product_id as number);
      variantItems.push({ product_id: pid, price: item.fixed_price });
    } else if (hasTemplate) {
      const tid = Array.isArray(item.product_tmpl_id)
        ? item.product_tmpl_id[0]
        : (item.product_tmpl_id as number);
      tmplItems.push({ product_tmpl_id: tid, price: item.fixed_price });
    } else if (hasCategory) {
      const cid = Array.isArray(item.categ_id)
        ? item.categ_id[0]
        : (item.categ_id as number);
      categItems.push({ categ_id: cid, price: item.fixed_price });
    } else {
      globalItems.push({ price: item.fixed_price });
    }
  }

  const result: OdooPriceLine[] = [];

  for (const p of products) {
    const prodId = p.id;
    const tmplId = tmplIdByProdId.get(prodId) ?? null;
    const categId = categIdByProdId.get(prodId) ?? null;

    let chosenPrice: number | null = null;

    const vItem = variantItems.find((vi) => vi.product_id === prodId);
    if (vItem) {
      chosenPrice = vItem.price;
    } else if (tmplId != null) {
      const tItem = tmplItems.find((ti) => ti.product_tmpl_id === tmplId);
      if (tItem) {
        chosenPrice = tItem.price;
      } else if (categId != null) {
        const cItem = categItems.find((ci) => ci.categ_id === categId);
        if (cItem) {
          chosenPrice = cItem.price;
        } else if (globalItems.length) {
          chosenPrice = globalItems[globalItems.length - 1].price;
        }
      } else if (globalItems.length) {
        chosenPrice = globalItems[globalItems.length - 1].price;
      }
    } else if (categId != null) {
      const cItem = categItems.find((ci) => ci.categ_id === categId);
      if (cItem) {
        chosenPrice = cItem.price;
      } else if (globalItems.length) {
        chosenPrice = globalItems[globalItems.length - 1].price;
      }
    } else if (globalItems.length) {
      chosenPrice = globalItems[globalItems.length - 1].price;
    }

    if (chosenPrice != null) {
      result.push({
        default_code: p.default_code,
        price: chosenPrice,
      });
    }
  }

  return result;
}
