// app/api/sync-products-all/route.ts
import { NextRequest } from "next/server";
import {
  getOdooProductsPage,
  getOdooStockBySkus,
  getPricesFromPricelistForSkus,
} from "@/lib/odooClient";
import { upsertProductFromOdoo } from "@/lib/shopifyClient";

// ID de la lista de precios FULL (PRECIOFULL)
// Lo ideal es tenerlo en el .env como ODOO_PRICELIST_ID=625
const PRECIOFULL_ID = Number(process.env.ODOO_PRICELIST_ID || "625");

/**
 * Sincroniza UNA PÁGINA de productos PAY desde Odoo hacia Shopify.
 *
 * Uso (POST):
 *   /api/sync-products-all
 *   /api/sync-products-all?offset=0&limit=50
 *   /api/sync-products-all?offset=50&limit=50
 *   /api/sync-products-all?offset=100&limit=50
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Puedes controlar cuántos productos procesa por llamada
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50;
    const offset = offsetParam ? parseInt(offsetParam, 10) || 0 : 0;

    // 1) Traemos UNA PÁGINA de productos desde Odoo
    const odooProducts = await getOdooProductsPage(limit, offset);

    if (!odooProducts.length) {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "Sin productos en este rango",
          limit,
          offset,
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

    const skus = odooProducts.map((p) => p.default_code);

    // 2) Stock por SKU en Odoo
    const stockLines = await getOdooStockBySkus(skus);
    const stockBySku = new Map<string, number>(
      stockLines.map((l) => [l.default_code, l.qty_available])
    );

    // 3) Precios desde PRECIOFULL por SKU
    const priceLines = await getPricesFromPricelistForSkus(PRECIOFULL_ID, skus);
    const priceBySku = new Map<string, number>(
      priceLines.map((pl) => [pl.default_code, pl.price])
    );

    const created: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
      product_status: "active" | "draft";
      odoo_price: number | null;
      odoo_qty: number;
    }> = [];

    const updated: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
      product_status: "active" | "draft";
      odoo_price: number | null;
      odoo_qty: number;
    }> = [];

    const errors: Array<{
      odoo_id: number;
      sku: string;
      product_status: "active" | "draft";
      odoo_price: number | null;
      odoo_qty: number;
      message: string;
    }> = [];

    // 4) Recorremos SOLO esta página de productos
    for (const p of odooProducts) {
      const sku = p.default_code;
      const stockQty = stockBySku.get(sku) ?? 0;
      const pricelistPrice = priceBySku.get(sku);

      // --- Lógica de precio efectivo ---
      // 1) Si hay regla en PRECIOFULL → usamos ese precio
      // 2) Si NO hay regla, pero list_price > 1 → usamos list_price
      // 3) Si list_price es 0 o 1 → consideramos que NO tiene precio real
      let effectivePrice: number | null = null;

      if (typeof pricelistPrice === "number") {
        effectivePrice = pricelistPrice;
      } else if (p.list_price && p.list_price > 1) {
        effectivePrice = p.list_price;
      } else {
        effectivePrice = null; // sin precio útil
      }

      const hasPrice = effectivePrice !== null && effectivePrice > 1;
      const hasStock = stockQty > 0;

      // Si NO tiene precio y NO tiene stock → lo mandamos como borrador
      // Si tiene precio o stock → activo
      const productStatus: "active" | "draft" =
        hasPrice || hasStock ? "active" : "draft";

      // Construimos el objeto con el precio que realmente queremos en Shopify
      const productForShopify = {
        ...p,
        list_price: effectivePrice ?? 0,
      };

      try {
        const result = await upsertProductFromOdoo(
          productForShopify as any,
          productStatus
        );

        const baseItem = {
          odoo_id: p.id,
          shopify_product_id: result.product_id,
          sku,
          product_status: productStatus,
          odoo_price: effectivePrice,
          odoo_qty: stockQty,
        };

        if (result.mode === "created") {
          created.push(baseItem);
        } else {
          updated.push(baseItem);
        }
      } catch (err: any) {
        console.error("Error upsert producto Shopify", sku, err);
        errors.push({
          odoo_id: p.id,
          sku,
          product_status: productStatus,
          odoo_price: effectivePrice,
          odoo_qty: stockQty,
          message: err?.message || "Error desconocido",
        });
      }
    }

    // Para saber cuál sería el siguiente offset
    const nextOffset = offset + odooProducts.length;

    return new Response(
      JSON.stringify({
        ok: true,
        limit,
        offset,
        next_offset: nextOffset,
        total_processed: odooProducts.length,
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
    console.error("Error en sync-products-all (paginado):", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
