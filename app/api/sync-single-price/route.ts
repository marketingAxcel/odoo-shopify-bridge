import { NextRequest } from "next/server";
import { findProductsBySku, getOdooStockBySkus } from "@/lib/odooClient";
import {
  getVariantsBySku,
  getVariantPriceBySku,
  updateVariantPriceBySku,
} from "@/lib/shopifyClient";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku")?.trim() || "";

    if (!sku) {
      return new Response(
        JSON.stringify({ ok: false, error: "Falta el parámetro sku" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const odooProducts = await findProductsBySku([sku]);
    const odooProduct = odooProducts[0] ?? null;

    let odooStock = null;
    let odooQty: number | null = null;

    if (odooProduct) {
      const stockLines = await getOdooStockBySkus([sku]);
      odooStock = stockLines[0] ?? null;
      odooQty = odooStock ? odooStock.qty_available ?? null : null;
    }

    const variants = await getVariantsBySku(sku);
    const shopifyVariant = variants[0] ?? null;

    let shopifyPrice: number | null = null;
    if (shopifyVariant) {
      shopifyPrice = await getVariantPriceBySku(sku);
    }

    let updatedShopifyPrice: number | null = null;
    if (odooProduct && typeof odooProduct.list_price === "number") {
      const odooPrice = odooProduct.list_price;
      if (shopifyVariant) {
        await updateVariantPriceBySku(sku, odooPrice);
        updatedShopifyPrice = odooPrice;
      }
    }

    const body = {
      ok: true,
      sku,
      odoo: odooProduct
        ? {
            id: odooProduct.id,
            name: odooProduct.name,
            list_price: odooProduct.list_price,
            qty_available: odooQty,
          }
        : null,
      shopify: shopifyVariant
        ? {
            product_id: shopifyVariant.product_id,
            variant_id: shopifyVariant.id,
            inventory_item_id: shopifyVariant.inventory_item_id,
            price_before: shopifyPrice,
            price_after:
              updatedShopifyPrice !== null ? updatedShopifyPrice : shopifyPrice,
          }
        : null,
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || "Error interno en sync-single-price",
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}

export { GET as POST };
