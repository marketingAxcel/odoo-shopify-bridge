// app/api/sync-products-all/route.ts
import { NextRequest } from "next/server";
import {
  getOdooProductsPage,
  getOdooStockBySkus,
  getPricesFromPricelistForSkus,
} from "@/lib/odooClient";
import { upsertProductFromOdoo } from "@/lib/shopifyClient";

// Tipo local para el status de producto en Shopify
type ShopifyProductStatus = "active" | "draft" | "archived";

// 👇 Ajusta este ID si tu lista PRECIOFULL tiene otro ID en Odoo
const PRECIOFULL_ID = 1;

/**
 * Sincroniza productos PAY de Odoo a Shopify, por "bloques" (paginado).
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

    // 2) Precios desde la lista PRECIOFULL + stock desde Odoo
    const [priceLines, stockLines] = await Promise.all([
      getPricesFromPricelistForSkus(PRECIOFULL_ID, skus),
      getOdooStockBySkus(skus),
    ]);

    // Mapas auxiliares
    const priceBySku = new Map<string, number>();
    for (const line of priceLines) {
      priceBySku.set(line.default_code, line.price);
    }

    const stockBySku = new Map<string, { qty_available: number }>();
    for (const line of stockLines) {
      stockBySku.set(line.default_code, {
        qty_available: line.qty_available,
      });
    }

    const created: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
      product_status: ShopifyProductStatus;
      odoo_price: number | null;
      odoo_qty: number;
    }> = [];

    const updated: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
      product_status: ShopifyProductStatus;
      odoo_price: number | null;
      odoo_qty: number;
    }> = [];

    const errors: Array<{
      odoo_id: number;
      sku: string;
      product_status: ShopifyProductStatus;
      odoo_price: number | null;
      odoo_qty: number;
      message: string;
    }> = [];

    // 3) Procesar cada producto de esta página
    for (const p of odooProducts) {
      const sku = p.default_code;

      // Precio desde PRECIOFULL si existe, si no desde list_price
      const odooPriceFromList = priceBySku.get(sku) ?? null;
      const odooPrice =
        odooPriceFromList ??
        (typeof p.list_price === "number" ? p.list_price : null);

      // Stock desde Odoo
      const stockLine = stockBySku.get(sku);
      const odooQty = stockLine?.qty_available ?? 0;

      // 🔹 REGLA NUEVA:
      // Precio "malo" = null, 0 o 1 → siempre borrador
      // Precio válido (> 1) → activo (tenga o no stock)
      const badPrice = !odooPrice || odooPrice <= 1;
      const productStatus: ShopifyProductStatus = badPrice
        ? "draft"
        : "active";

      try {
        // Forzamos que el precio que mandamos a Shopify sea el que calculamos
        const odooProductForShopify = {
          ...p,
          list_price: odooPrice ?? 0, // si es null, mandamos 0 (queda en draft)
        };

        const result = await upsertProductFromOdoo(
          odooProductForShopify,
          productStatus
        );

        const base = {
          odoo_id: p.id,
          shopify_product_id: result.product_id,
          sku,
          product_status: productStatus,
          odoo_price: odooPrice,
          odoo_qty: odooQty,
        };

        if (result.mode === "created") {
          created.push(base);
        } else {
          updated.push(base);
        }
      } catch (err: any) {
        console.error("Error upsert producto Shopify", sku, err);
        errors.push({
          odoo_id: p.id,
          sku,
          product_status: productStatus,
          odoo_price: odooPrice,
          odoo_qty: odooQty,
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
