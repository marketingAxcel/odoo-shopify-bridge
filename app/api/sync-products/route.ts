import { NextRequest } from "next/server";
import { getOdooProductsPage } from "@/lib/odooClient";
import { upsertProductFromOdoo } from "@/lib/shopifyClient";


export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") || "10");
    const offset = Number(searchParams.get("offset") || "0");

    const odooProducts = await getOdooProductsPage(limit, offset);

    const created: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
    }> = [];

    const updated: Array<{
      odoo_id: number;
      shopify_product_id: number;
      sku: string;
    }> = [];

    const errors: Array<{ odoo_id: number; sku: string; message: string }> = [];

    for (const p of odooProducts) {
      try {
        const result = await upsertProductFromOdoo(p);

        const baseItem = {
          odoo_id: p.id,
          shopify_product_id: result.product_id,
          sku: p.default_code,
        };

        if (result.mode === "created") {
          created.push(baseItem);
        } else {
          updated.push(baseItem);
        }
      } catch (err: any) {
        console.error("Error upsert producto Shopify", p.default_code, err);
        errors.push({
          odoo_id: p.id,
          sku: p.default_code,
          message: err?.message || "Error desconocido",
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        fetched_from_odoo: odooProducts.length,
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
    console.error("Error en sync-products:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
