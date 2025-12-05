// app/api/sync-products/route.ts
import { NextRequest } from "next/server";
import { getOdooProductsPage } from "@/lib/odooClient";
import { createProductFromOdoo } from "@/lib/shopifyClient";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") || "10");
    const offset = Number(searchParams.get("offset") || "0");

    // 1) Traer productos desde Odoo
    const odooProducts = await getOdooProductsPage(limit, offset);

    const created: Array<{
      odoo_id: number;
      shopify_id: number;
      sku: string;
    }> = [];

    // 2) Crear productos en Shopify
    for (const p of odooProducts) {
      try {
        const shopProduct = await createProductFromOdoo(p);
        created.push({
          odoo_id: p.id,
          shopify_id: shopProduct.id,
          sku: p.default_code,
        });
      } catch (err) {
        console.error(
          "Error creando producto en Shopify",
          p.default_code,
          err
        );
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        synced: created.length,
        items: created,
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
