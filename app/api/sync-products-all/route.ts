// app/api/sync-products-all/route.ts
import { NextRequest } from "next/server";
import { getOdooProductsPage } from "@/lib/odooClient";
import {
  getVariantsBySku,
  createProductFromOdoo,
  updateVariantPriceBySku,
  updateProductStatus,
  ShopifyProductStatus,
} from "@/lib/shopifyClient";

/**
 * Recorre una página de productos PAY en Odoo
 * y sincroniza con Shopify:
 *
 * - Precio SIEMPRE tomado del producto en Odoo (list_price) SIN IVA.
 * - Si NO hay precio válido (null, 0, 1) => product.status = "draft".
 * - Si hay precio válido (> 1) => product.status = "active" + se actualiza el precio de la variante.
 *
 * Uso:
 *   POST /api/sync-products-all?limit=50&offset=0
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") ?? "50");
    const offset = Number(searchParams.get("offset") ?? "0");

    // 1) Página de productos desde Odoo (solo PAY...)
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

    // 2) Recorrer productos y sincronizar
    for (const p of odooProducts) {
      const sku = p.default_code;
      const odooPrice =
        typeof p.list_price === "number" && Number.isFinite(p.list_price)
          ? p.list_price
          : null;

      // Regla:
      // - SIN precio válido (null, 0, 1) → draft
      // - CON precio válido > 1 → active
      const hasValidPrice =
        typeof odooPrice === "number" && Number.isFinite(odooPrice) && odooPrice > 1;

      const status: ShopifyProductStatus = hasValidPrice ? "active" : "draft";

      try {
        // Buscar si ya existe en Shopify
        const variants = await getVariantsBySku(sku);

        if (variants.length) {
          const first = variants[0];

          // 1) Si tiene precio válido, sobre-escribimos el precio de la variante
          if (hasValidPrice) {
            await updateVariantPriceBySku(sku, odooPrice!);
          }

          // 2) Actualizamos status del producto (aunque el precio sea inválido)
          await updateProductStatus(first.product_id, status);

          updated.push({
            odoo_id: p.id,
            shopify_product_id: first.product_id,
            sku,
            product_status: status,
            odoo_price: hasValidPrice ? odooPrice! : null,
          });
        } else {
          // No existe en Shopify → lo creamos
          // Para crear, usamos:
          // - status = active/draft según list_price
          // - precio inicial = list_price válido; si no, 0
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
