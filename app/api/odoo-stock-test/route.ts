import { NextRequest } from "next/server";
import { getOdooStockBySkus } from "@/lib/odooClient";

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

    const lines = await getOdooStockBySkus([sku]);

    return new Response(
      JSON.stringify({ ok: true, sku, odoo_stock: lines }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error en odoo-stock-test:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Error interno" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
