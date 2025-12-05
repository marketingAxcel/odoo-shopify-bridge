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
