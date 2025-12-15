// app/api/sync-products-all/route.ts
import { NextRequest } from "next/server";
import {
  getOdooProductsPage,
  getPricesFromPricelistForSkus,
} from "@/lib/odooClient";
import {
  createProductFromOdoo,
  getVariantsBySku,
  updateProductStatus,
  ShopifyProductStatus,
  OdooProductLike,
} from "@/lib/shopifyClient";

// 👇 Ajusta este ID si tu lista PRECIOFULL tiene otro ID en Odoo
const PRECIOFULL_ID = 625;

/**
 * Sincroniza productos PAY de Odoo a Shopify por "bloques" (paginado),
 * SOLO para:
 *   - crear los productos que falten en Shopify
 *   - asegurar que el status sea:
 *       * "active" si el SKU está en PRECIOFULL
 *       * "draft"  si NO está en PRECIOFULL
 *
 * NO toca precios ni inventario de productos ya existentes.
 *
 * Uso desde Postman / cron:
 *   POST /api/sync-products-all?limit=50&offset=0
 *   POST /api/sync-products-all?limit=50&offset=50
 *   ...
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    const limit =
      limitParam && !Number.isNaN(Number(limitParam)) && Number(limitParam) > 0
        ? Number(limitParam)
        : 50;

    const offset =
      offsetParam &&
      !Number.isNaN(Number(offsetParam)) &&
      Number(offsetParam) >= 0
        ? Number(offsetParam)
        : 0;

    // 1) Página de productos desde Odoo
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
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const skus = odooProducts
      .map((p) => p.default_code)
      .filter((sku) => !!sku);

    // 2) Precios desde PRECIOFULL (solo para saber quién pertenece a la lista)
    const priceLines = await getPricesFromPricelistForSkus(PRECIOFULL_ID, skus);

    const priceBySku = new Map<string, number>();
    for (const line of priceLines) {
      priceBySku.set(line.default_code, line.price);
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

    const errors: Array<{
      odoo_id: number;
      sku: string;
      desired_status: ShopifyProductStatus;
      odoo_price: number | null;
      message: string;
    }> = [];

    // 3) Procesar cada producto de esta página
    for (const p of odooProducts as OdooProductLike[]) {
      const sku = p.default_code;

      // 🔹 ¿Tiene precio en la lista PRECIOFULL?
      const priceFromPricelist = priceBySku.get(sku);
      const hasPriceInPricelist =
        priceFromPricelist !== null && priceFromPricelist !== undefined;

      // 🔹 Regla:
      //   - En PRECIOFULL → active
      //   - No en PRECIOFULL → draft
      const desiredStatus: ShopifyProductStatus = hasPriceInPricelist
        ? "active"
        : "draft";

      const odooPrice = hasPriceInPricelist ? priceFromPricelist! : null;

      try {
        // ¿Ya existe el SKU en Shopify?
        const variants = await getVariantsBySku(sku);

        if (!variants.length) {
          // 👉 No existe → lo creamos
          const priceForNew = hasPriceInPricelist ? odooPrice : 0;

          const product = await createProductFromOdoo(
            p,
            desiredStatus,
            priceForNew
          );

          created.push({
            odoo_id: p.id,
            shopify_product_id: product.id,
            sku,
            product_status: desiredStatus,
            odoo_price: odooPrice,
          });
        } else {
          // 👉 Ya existe → solo aseguramos el status deseado
          const productId = variants[0].product_id;

          await updateProductStatus(productId, desiredStatus);

          updated.push({
            odoo_id: p.id,
            shopify_product_id: productId,
            sku,
            product_status: desiredStatus,
            odoo_price: odooPrice,
          });
        }
      } catch (err: any) {
        console.error("Error sync status producto Shopify", sku, err);
        errors.push({
          odoo_id: p.id,
          sku,
          desired_status: desiredStatus,
          odoo_price: odooPrice,
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
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error en sync-products-all:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || "Error interno",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
