import { NextRequest } from "next/server";
import { getOdooProductsPage } from "@/lib/odooClient";
import {
  getVariantsBySku,
  createProductFromOdoo,
  updateVariantPriceBySku,
  updateProductStatus,
  ShopifyProductStatus,
} from "@/lib/shopifyClient";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") ?? "50");
    const offset = Number(searchParams.get("offset") ?? "0");

    const odooProducts = await getOdooProductsPage(limit, offset);

    if (!odooProducts.length) {
      return new Response(
        JSON.stringify({
          ok: true,
          limit,
          offset,
          next_offset: null,
          total_processed: 0,
          created_count: 0,
          updated_count: 0,
          created: [],
          updated: [],
          errors: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const created: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
      product_status: ShopifyProductStatus;
      odoo_price: number | null;
    }> = [];

    const updated: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
      product_status: ShopifyProductStatus;
      odoo_price: number | null;
    }> = [];

    const errors: Array<{ odoo_id: number; sku: string; message: string }> = [];

    for (const p of odooProducts) {
      const sku = p.default_code;
      const odooPrice =
        typeof p.list_price === "number" && Number.isFinite(p.list_price)
          ? p.list_price
          : null;

      const hasValidPrice =
        typeof odooPrice === "number" && Number.isFinite(odooPrice) && odooPrice > 1;

      const status: ShopifyProductStatus = hasValidPrice ? "active" : "draft";

      try {
        const variants = await getVariantsBySku(sku);

        if (variants.length) {
          const first = variants[0];

          if (hasValidPrice) {
            await updateVariantPriceBySku(sku, odooPrice!);
          }

          await updateProductStatus(first.product_id, status);

          updated.push({
            odoo_id: p.id,
            shopify_product_id: first.product_id,
            sku,
            product_status: status,
            odoo_price: hasValidPrice ? odooPrice! : null,
          });
        } else {
          const priceForCreate = hasValidPrice ? odooPrice! : 0;

          const product = await createProductFromOdoo(
            {
              ...p,
              list_price: priceForCreate,
            },
            status
          );

          created.push({
            odoo_id: p.id,
            shopify_product_id: product.id,
            sku,
            product_status: status,
            odoo_price: hasValidPrice ? odooPrice! : null,
          });
        }
      } catch (err: any) {
        console.error("Error sync producto Shopify", sku, err);
        errors.push({
          odoo_id: p.id,
          sku,
          message: err?.message || "Error desconocido",
        });
      }
    }

    const totalProcessed = odooProducts.length;
    const nextOffset = offset + totalProcessed;

    return new Response(
      JSON.stringify({
        ok: true,
        limit,
        offset,
        next_offset: nextOffset,
        total_processed: totalProcessed,
        created_count: created.length,
        updated_count: updated.length,
        created,
        updated,
        errors,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error en sync-products-all:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || "Error interno",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
