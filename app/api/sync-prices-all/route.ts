import { NextRequest } from "next/server";
import {
  getOdooProductsPage,
  getPricesFromPricelistForSkus,
} from "@/lib/odooClient";
import { updateVariantPriceBySku } from "@/lib/shopifyClient";

const PRICELIST_FULL_ID = Number(process.env.ODOO_PRICELIST_FULL_ID || "0");

export async function POST(_req: NextRequest) {
  try {
    if (!PRICELIST_FULL_ID) {
      throw new Error(
        "Falta ODOO_PRICELIST_FULL_ID en las variables de entorno"
      );
    }

    const PAGE_SIZE = 50;
    let offset = 0;

    let processedSkus = 0;
    let updated = 0;
    const details: Array<{
      sku: string;
      odoo_price: number | null;
      variant_id: number | null;
      new_shopify_price: string | null;
      error?: string;
    }> = [];

    while (true) {
      const odooProducts = await getOdooProductsPage(PAGE_SIZE, offset);
      if (!odooProducts.length) break;

      const skus = odooProducts.map((p) => p.default_code);
      processedSkus += skus.length;

      const priceLines = await getPricesFromPricelistForSkus(
        PRICELIST_FULL_ID,
        skus
      );

      const priceBySku = new Map<string, number>();
      for (const line of priceLines) {
        priceBySku.set(line.default_code, line.price);
      }

      for (const sku of skus) {
        const odooPrice = priceBySku.get(sku) ?? null;
        const detail: any = {
          sku,
          odoo_price: odooPrice,
          variant_id: null,
          new_shopify_price: null,
        };

        if (odooPrice == null) {
          detail.error = "Sin precio en Odoo (ni PRECIOFULL ni list_price)";
          details.push(detail);
          continue;
        }

        try {
          const variant = await updateVariantPriceBySku(sku, odooPrice);

          if (!variant) {
            detail.error = "SKU no encontrado en Shopify";
          } else {
            detail.variant_id = variant.id;
            detail.new_shopify_price = variant.price;
            updated++;
          }
        } catch (err: any) {
          console.error("Error actualizando precio", sku, err);
          detail.error = err?.message || "Error desconocido";
        }

        details.push(detail);
      }

      offset += PAGE_SIZE;
      if (offset > 5000) break; 
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed_skus: processedSkus,
        updated,
        details,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error en sync-prices-all:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
