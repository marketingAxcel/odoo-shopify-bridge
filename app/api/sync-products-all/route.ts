// app/api/sync-products-all/route.ts
import { NextRequest } from "next/server";
import {
  getOdooProductsPage,
  getOdooStockBySkus,
  getPricesFromPricelistForSkus,
} from "@/lib/odooClient";
import {
  upsertProductFromOdoo,
  ShopifyProductStatus,
} from "@/lib/shopifyClient";

// ID de la lista de precios PRECIOFULL en Odoo
// 🔴 Si tu lista PRECIOFULL tiene otro ID, cámbialo acá:
const PRECIOFULL_PRICELIST_ID = 3;

/**
 * Recorre UNA página de productos PAY en Odoo
 * y hace upsert en Shopify (crear/actualizar sin duplicar),
 * marcando como:
 *  - "draft" si el precio es 0, 1 o null
 *  - "active" si el precio > 1
 *
 * Uso (ejemplos):
 *   POST /api/sync-products-all           → limit=50, offset=0 por defecto
 *   POST /api/sync-products-all?offset=0
 *   POST /api/sync-products-all?offset=50
 *   POST /api/sync-products-all?offset=100
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    const limit = Math.min(
      Math.max(Number(limitParam ?? "50") || 50, 1),
      200
    );
    const offset = Number(offsetParam ?? "0") || 0;

    // 1) Traemos una página de productos PAY desde Odoo
    const odooProducts = await getOdooProductsPage(limit, offset);

    if (!odooProducts.length) {
      return new Response(
        JSON.stringify({
          ok: true,
          limit,
          offset,
          next_offset: offset + limit,
          total_processed: 0,
          created_count: 0,
          updated_count: 0,
          created: [],
          updated: [],
          errors: [],
          message: "No hay más productos en este rango",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const skus = odooProducts.map((p) => p.default_code);

    // 2) Traemos precios desde PRECIOFULL para esos SKUs
    const priceLines = await getPricesFromPricelistForSkus(
      PRECIOFULL_PRICELIST_ID,
      skus
    );
    const priceMap = new Map<string, number>();
    for (const pl of priceLines) {
      priceMap.set(pl.default_code, pl.price);
    }

    // 3) Traemos stock desde Odoo (qty_available)
    const stockLines = await getOdooStockBySkus(skus);
    const stockMap = new Map<string, number>();
    for (const sl of stockLines) {
      stockMap.set(sl.default_code, sl.qty_available);
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
      message: string;
    }> = [];

    // 4) Recorremos los productos de esta página
    for (const p of odooProducts) {
      const sku = p.default_code;

      const precioFull = priceMap.has(sku)
        ? priceMap.get(sku)!
        : null;

      const stockQty = stockMap.get(sku) ?? 0;

      // Precio real que usaremos para decidir el status:
      // 1) Si hay PRECIOFULL → lo usamos
      // 2) Si no, usamos list_price de Odoo
      let priceFromOdoo: number | null = null;

      if (precioFull != null) {
        priceFromOdoo = precioFull;
      } else if (typeof p.list_price === "number") {
        priceFromOdoo = p.list_price;
      }

      // Regla de borrador:
      // - draft si precio es null, 0 o 1
      // - active si precio > 1
      const isMissingOrInvalidPrice =
        priceFromOdoo == null || priceFromOdoo <= 1;

      const productStatus: ShopifyProductStatus = isMissingOrInvalidPrice
        ? "draft"
        : "active";

      // Lo que mandamos a Shopify como "list_price" para la variante:
      const listPriceToSend = !isMissingOrInvalidPrice
        ? priceFromOdoo!
        : 0;

      const productForUpsert = {
        ...p,
        list_price: listPriceToSend,
      };

      try {
        const result = await upsertProductFromOdoo(
          productForUpsert,
          productStatus
        );

        const baseItem = {
          odoo_id: p.id,
          shopify_product_id: result.product_id,
          sku,
          product_status: productStatus,
          odoo_price: priceFromOdoo,
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
          message: err?.message || "Error desconocido",
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        limit,
        offset,
        next_offset: offset + limit,
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
