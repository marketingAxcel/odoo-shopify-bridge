import { NextRequest } from "next/server";
import {
  getOdooProductsPage,
  getPricesFromPricelistForSkus,
} from "@/lib/odooClient";
import { getVariantPriceBySku } from "@/lib/shopifyClient";

const PRICELIST_FULL_ID = Number(process.env.ODOO_PRICELIST_FULL_ID || "0");

export async function GET(_req: NextRequest) {
  try {
    if (!PRICELIST_FULL_ID) {
      throw new Error(
        "Falta ODOO_PRICELIST_FULL_ID en las variables de entorno"
      );
    }

    const PAGE_SIZE = 50;
    let offset = 0;

    type Prod = {
      id: number;
      name: string;
      default_code: string;
    };

    const allProducts: Prod[] = [];

    while (true) {
      const page = await getOdooProductsPage(PAGE_SIZE, offset);
      if (!page.length) break;

      for (const p of page) {
        allProducts.push({
          id: p.id,
          name: p.name,
          default_code: p.default_code,
        });
      }

      offset += PAGE_SIZE;
      if (offset > 5000) break; 
    }

    if (!allProducts.length) {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            message: "No se encontraron productos PAY en Odoo",
            total_products: 0,
            items: [],
          },
          null,
          2
        ),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const items: Array<{
      sku: string;
      odoo_id: number;
      name: string;
      odoo_price: number | null;
      shopify_price: number | null;
      status:
        | "ok"
        | "no_odoo_price"
        | "no_shopify_variant"
        | "price_mismatch";
    }> = [];

    const CHUNK_SIZE = 30;

    for (let i = 0; i < allProducts.length; i += CHUNK_SIZE) {
      const chunk = allProducts.slice(i, i + CHUNK_SIZE);
      const skus = chunk.map((p) => p.default_code);

      const priceLines = await getPricesFromPricelistForSkus(
        PRICELIST_FULL_ID,
        skus
      );

      const odooPriceBySku = new Map<string, number>();
      for (const line of priceLines) {
        odooPriceBySku.set(line.default_code, line.price);
      }

      for (const p of chunk) {
        const sku = p.default_code;

        const odooPrice = odooPriceBySku.has(sku)
          ? (odooPriceBySku.get(sku) as number)
          : null;

        let shopifyPrice: number | null = null;
        try {
          shopifyPrice = await getVariantPriceBySku(sku);
        } catch (e) {

          shopifyPrice = null;
        }

        let status:
          | "ok"
          | "no_odoo_price"
          | "no_shopify_variant"
          | "price_mismatch";

        if (odooPrice == null && shopifyPrice == null) {
          status = "no_odoo_price"; 
        } else if (odooPrice == null && shopifyPrice != null) {
          status = "no_odoo_price";
        } else if (odooPrice != null && shopifyPrice == null) {
          status = "no_shopify_variant";
        } else {
          const diff = Math.abs((shopifyPrice as number) - (odooPrice as number));
          status = diff < 0.01 ? "ok" : "price_mismatch";
        }

        items.push({
          sku,
          odoo_id: p.id,
          name: p.name,
          odoo_price: odooPrice,
          shopify_price: shopifyPrice,
          status,
        });
      }
    }

    const summary = {
      total_products: allProducts.length,
      ok: items.filter((i) => i.status === "ok").length,
      no_odoo_price: items.filter((i) => i.status === "no_odoo_price").length,
      no_shopify_variant: items.filter((i) => i.status === "no_shopify_variant").length,
      price_mismatch: items.filter((i) => i.status === "price_mismatch").length,
    };

    return new Response(
      JSON.stringify(
        {
          ok: true,
          pricelist_id: PRICELIST_FULL_ID,
          summary,
          items,
        },
        null,
        2
      ),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error en /api/prices-diff:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
