const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOP_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;
const LOCATION_ID = Number(process.env.SHOPIFY_LOCATION_ID!);

function toShopifyPrice(value: unknown, decimals = 0): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals);
  }
  
  if (typeof value === "string") {
    const s = value.trim();
    
    if (s.includes(",") && s.includes(".")) {
      const n = Number(s.replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(n)) return decimals === 0 ? String(Math.round(n)) : n.toFixed(decimals);
    }
    
    if (s.includes(",") && !s.includes(".")) {
      const n = Number(s.replace(",", "."));
      if (Number.isFinite(n)) return decimals === 0 ? String(Math.round(n)) : n.toFixed(decimals);
    }
    
    const n = Number(s);
    if (Number.isFinite(n)) return decimals === 0 ? String(Math.round(n)) : n.toFixed(decimals);
  }
  
  return decimals === 0 ? "0" : (0).toFixed(decimals);
}


if (!SHOP_DOMAIN || !SHOP_TOKEN) {
  console.warn(
    "[ShopifyClient] Faltan variables de entorno SHOPIFY_STORE_DOMAIN o SHOPIFY_ACCESS_TOKEN"
  );
}

export type ShopifyProductStatus = "active" | "draft" | "archived";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  
  if (res.status === 429 && retry < 3) {
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfterSeconds = retryAfterHeader
    ? parseInt(retryAfterHeader, 10)
    : 2;
    
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

export async function getSomeProducts(limit = 3) {
  const data = await shopifyRequest(`products.json?limit=${limit}`);
  return data.products;
}

export type OdooProductLike = {
  id: number;
  name: string;
  default_code: string;
  list_price: number;
  description_sale?: string;
};


export async function getVariantsBySku(sku: string) {
  const matches: Array<{
    id: number;
    product_id: number;
    sku: string;
    inventory_item_id: number;
  }> = [];
  
  let sinceId = 0;
  
  while (true) {
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
    
    sinceId = products[products.length - 1].id;
  }
  
  return matches;
}

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
    
    sinceId = products[products.length - 1].id;
  }
  
  return map;
}


export async function createProductFromOdoo(
  p: OdooProductLike,
  productStatus: ShopifyProductStatus = "active",
  priceOverride?: number | null
) {
  const hasOverride = priceOverride !== null && priceOverride !== undefined;
  const numericPrice = hasOverride ? Number(priceOverride) : p.list_price;
  const finalPrice = Number.isFinite(numericPrice) ? numericPrice : 0;
  
  const payload = {
    product: {
      title: p.name,
      body_html: p.description_sale || "",
      vendor: "Paytton Tires",
      status: productStatus,
      variants: [
        {
          sku: p.default_code,
          price: toShopifyPrice(finalPrice, 0),
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
  
  const product = data.product;
  
  await upsertProductMetafield(
    product.id,
    "custom",
    "nombre_de_la_llanta",
    (p as any).tire_name || "",
    "single_line_text_field"
  );
  
  
  return product;
}


export async function updateVariantPriceBySku(sku: string, newPrice: number) {
  const variants = await getVariantsBySku(sku);
  if (!variants.length) return null;
  
  const variant = variants[0];
  
  const payload = {
    variant: {
      id: variant.id,
      price: toShopifyPrice(newPrice, 0), 
    },
  };
  
  const data = await shopifyRequest(`variants/${variant.id}.json`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  
  return data.variant;
}

export async function upsertProductFromOdoo(
  p: OdooProductLike,
  productStatus: ShopifyProductStatus = "active"
) {
  const variants = await getVariantsBySku(p.default_code);
  
  if (variants.length) {
    return {
      mode: "updated" as const,
      product_id: variants[0].product_id,
      variant_id: variants[0].id,
    };
  }
  
  const product = await createProductFromOdoo(p, productStatus);
  const variant = product.variants[0];
  
  return {
    mode: "created" as const,
    product_id: product.id,
    variant_id: variant.id,
  };
}

export async function updateProductStatus(
  productId: number,
  status: ShopifyProductStatus
) {
  const payload = {
    product: {
      id: productId,
      status,
    },
  };
  
  const data = await shopifyRequest(`products/${productId}.json`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  
  return data.product;
}

export async function getInventoryItemIdBySku(
  sku: string
): Promise<number | null> {
  const variants = await getVariantsBySku(sku);
  if (!variants.length) return null;
  return variants[0].inventory_item_id;
}

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
  
  return data.inventory_level;
}

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

export async function upsertProductMetafield(
  productId: number,
  namespace: string,
  key: string,
  value: string,
  type: string = "single_line_text_field"
) {
  const cleanValue = (value ?? "").toString().trim();
  
  if (!cleanValue) return null;
  
  const existing = await shopifyRequest(`products/${productId}/metafields.json?namespace=${encodeURIComponent(namespace)}&key=${encodeURIComponent(key)}`, {
    method: "GET",
  });
  
  const mf = (existing?.metafields || [])[0];
  
  if (mf?.id) {
    const payload = {
      metafield: {
        id: mf.id,
        value: cleanValue,
        type,
      },
    };
    
    const updated = await shopifyRequest(`metafields/${mf.id}.json`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    
    return updated.metafield;
  }
  
  const payload = {
    metafield: {
      namespace,
      key,
      value: cleanValue,
      type,
    },
  };
  
  const created = await shopifyRequest(`products/${productId}/metafields.json`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  
  return created.metafield;
}
