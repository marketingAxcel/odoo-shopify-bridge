// lib/shopifyClient.ts

// Variables de entorno necesarias (definidas en Vercel):
// SHOPIFY_STORE_DOMAIN = mvyu4p-em.myshopify.com
// SHOPIFY_ACCESS_TOKEN = shpat_...
// SHOPIFY_LOCATION_ID  = 86330769647

const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOP_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;
const LOCATION_ID = Number(process.env.SHOPIFY_LOCATION_ID!);

if (!SHOP_DOMAIN || !SHOP_TOKEN) {
  console.warn(
    "[ShopifyClient] Faltan variables de entorno SHOPIFY_STORE_DOMAIN o SHOPIFY_ACCESS_TOKEN"
  );
}

// 👉 Tipo para el estado del producto en Shopify
type ShopifyProductStatus = "active" | "draft" | "archived";

// Helper para “dormir” X ms
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Llamada REST genérica al Admin API de Shopify
 * Maneja 429 (rate limit) con hasta 3 reintentos.
 */
async function shopifyRequest(
  path: string,
  options: RequestInit = {},
  retry = 0
): Promise<any> {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/2024-01/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOP_TOKEN,
      ...(options.headers || {}),
    },
  });

  // ⚠️ Rate limit
  if (res.status === 429 && retry < 3) {
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfterSeconds = retryAfterHeader
      ? parseInt(retryAfterHeader, 10)
      : 2; // por defecto 2s

    const delayMs = Math.max(retryAfterSeconds, 1) * 1000;

    console.warn(
      `[ShopifyClient] 429 en ${path}, reintento ${retry + 1} en ${delayMs}ms`
    );

    await sleep(delayMs);
    return shopifyRequest(path, options, retry + 1);
  }

  if (!res.ok) {
    const text = await res.text();
    console.error("[Shopify error]", res.status, text);
    throw new Error(`Shopify request failed: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

/**
 * Solo para pruebas: traer algunos productos
 */
export async function getSomeProducts(limit = 3) {
  const data = await shopifyRequest(`products.json?limit=${limit}`);
  return data.products;
}

/**
 * Tipo base de producto Odoo que esperamos recibir
 * (lo mismo que devuelve getOdooProductsPage)
 */
type OdooProductLike = {
  id: number;
  name: string;
  default_code: string;
  list_price: number;
  description_sale?: string;
};

/**
 * Buscar variantes en Shopify por SKU
 * (lo usamos para saber si el SKU ya existe o no)
 */
export async function getVariantsBySku(sku: string) {
  const matches: Array<{
    id: number;
    product_id: number;
    sku: string;
    inventory_item_id: number;
  }> = [];

  let sinceId = 0;

  while (true) {
    // Traemos productos por páginas (máx 250) solo con id y variants
    const url = `products.json?limit=250&fields=id,variants${
      sinceId ? `&since_id=${sinceId}` : ""
    }`;

    const data = await shopifyRequest(url);
    const products = (data.products || []) as any[];

    if (!products.length) {
      break;
    }

    for (const p of products) {
      for (const v of p.variants || []) {
        if (v.sku === sku) {
          matches.push({
            id: v.id,
            product_id: p.id,
            sku: v.sku,
            inventory_item_id: v.inventory_item_id,
          });
        }
      }
    }

    // Para la siguiente página
    sinceId = products[products.length - 1].id;
  }

  return matches;
}

/**
 * Trae TODOS los productos de Shopify y construye
 * un mapa SKU -> inventory_item_id
 * (para no tener que preguntarle a Shopify SKU por SKU)
 */
export async function getAllInventoryItemsBySku(): Promise<
  Record<string, number>
> {
  const map: Record<string, number> = {};
  let sinceId = 0;

  while (true) {
    const url = `products.json?limit=250&fields=id,variants${
      sinceId ? `&since_id=${sinceId}` : ""
    }`;

    const data = await shopifyRequest(url);
    const products = (data.products || []) as any[];

    if (!products.length) break;

    for (const p of products) {
      for (const v of p.variants || []) {
        if (v.sku) {
          map[v.sku] = v.inventory_item_id;
        }
      }
    }

    // siguiente página
    sinceId = products[products.length - 1].id;
  }

  return map;
}

/**
 * Crear un producto nuevo en Shopify a partir de un producto de Odoo
 * - Crea 1 variante con SKU = default_code
 * - Precio = list_price
 * - Inventario inicial = 0 (se sincroniza aparte)
 *
 * 🔹 productStatus: "active" por defecto, pero puedes pasar "draft"
 *    cuando no tenga precio ni inventario.
 */
export async function createProductFromOdoo(
  p: OdooProductLike,
  productStatus: ShopifyProductStatus = "active"
) {
  const payload = {
    product: {
      title: p.name,
      body_html: p.description_sale || "",
      vendor: "Paytton Tires",
      status: productStatus,
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

/**
 * Actualizar SOLO el precio de la variante cuyo SKU coincida
 */
export async function updateVariantPriceBySku(
  sku: string,
  newPrice: number
) {
  const variants = await getVariantsBySku(sku);
  if (!variants.length) return null;

  const variant = variants[0];

  const payload = {
    variant: {
      id: variant.id,
      price: newPrice.toString(),
    },
  };

  const data = await shopifyRequest(`variants/${variant.id}.json`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  return data.variant;
}

/**
 * Upsert completo:
 * - Si el SKU ya existe en Shopify → actualiza precio
 * - Si NO existe → crea producto nuevo con 1 variante
 *
 * 🔹 productStatus es opcional:
 *    - por defecto "active"
 *    - pero desde tu ruta puedes llamar upsertProductFromOdoo(p, "draft")
 *      si en Odoo no tiene precio ni inventario.
 */
export async function upsertProductFromOdoo(
  p: OdooProductLike,
  productStatus: ShopifyProductStatus = "active"
) {
  const variants = await getVariantsBySku(p.default_code);

  if (variants.length) {
    // Ya existe → solo tocamos precio (no cambiamos status aquí)
    await updateVariantPriceBySku(p.default_code, p.list_price);

    return {
      mode: "updated" as const,
      product_id: variants[0].product_id,
      variant_id: variants[0].id,
    };
  }

  // No existe → lo creamos con el estado indicado
  const product = await createProductFromOdoo(p, productStatus);
  const variant = product.variants[0];

  return {
    mode: "created" as const,
    product_id: product.id,
    variant_id: variant.id,
  };
}

/**
 * Obtener inventory_item_id de una variante a partir del SKU
 */
export async function getInventoryItemIdBySku(
  sku: string
): Promise<number | null> {
  const variants = await getVariantsBySku(sku);
  if (!variants.length) return null;
  return variants[0].inventory_item_id;
}

/**
 * Fijar el nivel de inventario (available) para un inventory_item_id
 * en la LOCATION_ID configurada en env.
 */
export async function setInventoryLevel(
  inventoryItemId: number,
  available: number
) {
  if (!LOCATION_ID) {
    throw new Error(
      "SHOPIFY_LOCATION_ID no está definido en las variables de entorno"
    );
  }

  const payload = {
    location_id: LOCATION_ID,
    inventory_item_id: inventoryItemId,
    available,
  };

  const data = await shopifyRequest("inventory_levels/set.json", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  // Shopify responde algo como:
  // { "inventory_level": { inventory_item_id, location_id, available, ... } }
  return data.inventory_level;
}

/**
 * Obtener el precio actual de la variante en Shopify para un SKU dado.
 * NO modifica nada, solo consulta.
 */
export async function getVariantPriceBySku(
  sku: string
): Promise<number | null> {
  const variants = await getVariantsBySku(sku);
  if (!variants.length) return null;

  const variantId = variants[0].id;

  const data = await shopifyRequest(`variants/${variantId}.json`);
  const priceStr = data?.variant?.price;

  if (!priceStr) return null;

  const priceNum = Number(priceStr);
  if (!Number.isFinite(priceNum)) return null;

  return priceNum;
}
