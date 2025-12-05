const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOP_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;

async function shopifyRequest(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/2024-01/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOP_TOKEN,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Shopify error", res.status, text);
    throw new Error(`Shopify request failed: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export async function getSomeProducts(limit = 3) {
  const data = await shopifyRequest(`products.json?limit=${limit}`);
  return data.products;
}
// test env update

// NO importo el tipo de Odoo para no crear ciclos,
// simplemente documento qué campos espero.
type OdooProductLike = {
  id: number;
  name: string;
  default_code: string;
  list_price: number;
  description_sale?: string;
};

/**
 * Crear un producto en Shopify a partir de un producto de Odoo
 * - Crea 1 variante con SKU = default_code
 * - Precio = list_price
 * - Inventario inicial en 0 (luego lo sincronizamos aparte)
 */
export async function createProductFromOdoo(p: OdooProductLike) {
  const payload = {
    product: {
      title: p.name,
      body_html: p.description_sale || "",
      vendor: "Paytton Tires",
      status: "active",
      variants: [
        {
          sku: p.default_code,
          price: p.list_price.toString(),
          inventory_management: "shopify",
          inventory_policy: "deny",
          inventory_quantity: 0,
        },
      ],
    },
  };

  const data = await shopifyRequest("products.json", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return data.product;
}
