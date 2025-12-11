import { NextRequest } from "next/server";
import { getPricesFromPricelistForSkus } from "@/lib/odooClient";

const PRICELIST_FULL_ID = Number(process.env.ODOO_PRICELIST_FULL_ID || "0");

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku") || "";

    if (!sku) {
      return new Response(
        JSON.stringify({ error: "Falta parámetro ?sku=PAYXXX" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!PRICELIST_FULL_ID) {
      throw new Error("Falta ODOO_PRICELIST_FULL_ID");
    }

    const prices = await getPricesFromPricelistForSkus(
      PRICELIST_FULL_ID,
      [sku]
    );

    return new Response(
      JSON.stringify({ ok: true, sku, prices }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("odoo-price-test error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
