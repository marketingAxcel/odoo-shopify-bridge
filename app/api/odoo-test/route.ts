// app/api/odoo-test/route.ts
import { NextRequest } from "next/server";
import { findProductsBySku } from "@/lib/odooClient";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku") || "";

    if (!sku) {
      return new Response(
        JSON.stringify({
          error: "Falta parámetro ?sku=CODIGO_EN_ODOO",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const products = await findProductsBySku([sku]);

    return new Response(
      JSON.stringify({
        ok: true,
        products,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error Odoo test:", err);
    return new Response(
      JSON.stringify({
        error: err?.message || "Error interno",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
